import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin":      "https://www.querycrest.com",
  "Access-Control-Allow-Methods":     "POST, OPTIONS",
  "Access-Control-Allow-Headers":     "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: corsHeaders
      });
    }

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) {
      console.error("[chatbot] ANTHROPIC_API_KEY not set");
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not configured" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Auth: try Authorization header first, then HttpOnly cookie
    let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!token) {
      const cookies = req.headers.get("cookie") ?? "";
      const match   = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
      token         = match?.[1]?.trim();
    }
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: corsHeaders
      });
    }
    const userId = authData.user.id;

    const body = await req.json();
    const { action, message, history, conversation_id } = body;
    console.log("[chatbot] action:", action, "userId:", userId.slice(0, 8));

    // ── getConversation ───────────────────────────────────────────
    if (action === "getConversation") {
      let { data: conv, error: convErr } = await supabase
        .from("chat_conversations")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["ai", "waiting", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (convErr) {
        return new Response(JSON.stringify({ error: convErr.message }), {
          status: 500, headers: corsHeaders
        });
      }

      if (!conv) {
        const { data: newConv, error: insertErr } = await supabase
          .from("chat_conversations")
          .insert([{ user_id: userId, status: "ai" }])
          .select()
          .single();
        if (insertErr) {
          return new Response(JSON.stringify({ error: insertErr.message }), {
            status: 500, headers: corsHeaders
          });
        }
        conv = newConv;
      }

      const { data: messages } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true });

      return new Response(JSON.stringify({ conversation: conv, messages: messages || [] }), {
        status: 200, headers: corsHeaders
      });
    }

    // ── requestHuman ──────────────────────────────────────────────
    if (action === "requestHuman") {
      if (!conversation_id) {
        return new Response(JSON.stringify({ error: "conversation_id required" }), {
          status: 400, headers: corsHeaders
        });
      }

      await supabase
        .from("chat_conversations")
        .update({ status: "waiting", updated_at: new Date().toISOString() })
        .eq("id", conversation_id);

      await supabase.from("chat_messages").insert([{
        conversation_id,
        sender_id:   userId,
        sender_type: "ai",
        content:     "You have requested to speak with a human advisor. One of our team members will join shortly. Our support is available 24/7.",
        is_read:     false,
      }]);

      const { data: allUsers } = await supabase
        .from("users")
        .select("id, role, first_name, last_name");

      const adminList = (allUsers || []).filter((u: any) => {
        const r = u.role;
        if (Array.isArray(r)) return r.includes("admin");
        if (typeof r === "string") return r.replace(/[{}]/g, "").split(",").map((s: string) => s.trim()).includes("admin");
        return false;
      });

      if (adminList.length) {
        const { data: userRow } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", userId)
          .single();

        await supabase.from("notifications").insert(
          adminList.map((a: any) => ({
            user_id: a.id,
            type:    "action",
            title:   "Student requesting live support",
            message: `${userRow?.first_name || "A student"} ${userRow?.last_name || ""} is waiting for a human advisor in the chat.`,
            is_read: false,
          }))
        );
      }

      const { data: onlineAdmins } = await supabase
        .from("admin_presence")
        .select("admin_id")
        .eq("is_online", true);

      return new Response(JSON.stringify({
        success:     true,
        adminOnline: (onlineAdmins || []).length > 0,
        adminCount:  (onlineAdmins || []).length,
      }), { status: 200, headers: corsHeaders });
    }

    // ── sendMessage ───────────────────────────────────────────────
    if (action === "sendMessage") {
      if (!message) {
        return new Response(JSON.stringify({ error: "message required" }), {
          status: 400, headers: corsHeaders
        });
      }
      if (!conversation_id) {
        return new Response(JSON.stringify({ error: "conversation_id required" }), {
          status: 400, headers: corsHeaders
        });
      }

      const { data: conv } = await supabase
        .from("chat_conversations")
        .select("*")
        .eq("id", conversation_id)
        .single();

      if (!conv) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404, headers: corsHeaders
        });
      }

      await supabase.from("chat_messages").insert([{
        conversation_id,
        sender_id:   userId,
        sender_type: "user",
        content:     message,
        is_read:     false,
      }]);

      if (conv.status === "active") {
        return new Response(JSON.stringify({ mode: "human", reply: null }), {
          status: 200, headers: corsHeaders
        });
      }

      const [userRes, appsRes, docsRes, nokRes, planRes] = await Promise.all([
        supabase.from("users").select("first_name, last_name, email, phone, role").eq("id", userId).single(),
        supabase.from("applications").select("university_name, status, programs, attempt_type, created_at").eq("user_id", userId),
        supabase.from("documents").select("document_type").eq("user_id", userId),
        supabase.from("next_of_kin").select("id").eq("user_id", userId).limit(1),
        supabase.from("user_plans").select("plan_name, application_limit, applications_used").eq("user_id", userId).maybeSingle(),
      ]);

      const userData = userRes.data  || {};
      const apps     = appsRes.data  || [];
      const docs     = docsRes.data  || [];
      const hasNOK   = (nokRes.data  || []).length > 0;
      const plan     = planRes.data  || null;

      const appSummary = apps.length
        ? apps.map((a: any) =>
            `- ${a.university_name} | Status: ${a.status || "Submitted"} | Programmes: ${(a.programs || []).join(", ") || "None listed"} | Type: ${a.attempt_type || "first_time"}`
          ).join("\n")
        : "No applications submitted yet.";

      const docTypes   = docs.map((d: any) => d.document_type);
      const docSummary = docTypes.length
        ? docTypes.map((t: string) => `- ${t}`).join("\n")
        : "No documents uploaded yet.";

      const requiredDocs  = ["ID", "Proof of Residence", "Grade 12 Results", "Grade 11 Results"];
      const missingDocs   = requiredDocs.filter(req =>
        !docTypes.some((t: string) => t.toLowerCase().includes(req.toLowerCase()))
      );

      const planSummary = plan
        ? `Plan: ${plan.plan_name} | Applications used: ${plan.applications_used} of ${plan.application_limit}`
        : "Plan: Free (1 application)";

      const systemPrompt = `You are the QueryCrest Student Assistant — a warm, knowledgeable AI advisor for QueryCrest, a South African student application platform. You speak in a friendly, encouraging tone because students are often stressed and anxious about their future.

ABOUT QUERYCREST
QueryCrest is a South African platform that helps students apply to universities and colleges. We handle the entire application process on the student's behalf.

Main services:
- University & college applications (all 26 public SA universities + private colleges)
- Bursary applications (NSFAS: R150 | Other bursaries: price on request)

PLANS & PRICING
Starter: R60 — 1 application
Essential: R100 — 2 applications
Standard: R250 — 4 applications
Bundle: R500 — 7 applications
All-In-One: R1000 — 11 applications

STUDENT YOU ARE TALKING TO
Name: ${(userData as any).first_name || "Student"} ${(userData as any).last_name || ""}
Email: ${(userData as any).email || ""}
${planSummary}

Their applications:
${appSummary}

Their uploaded documents:
${docSummary}
${missingDocs.length ? "\nMissing documents: " + missingDocs.join(", ") : "\nAll core documents uploaded ✓"}
Next of kin added: ${hasNOK ? "Yes ✓" : "No — still needed"}

YOUR RULES
- Be warm and encouraging
- Use South African context: matric, NSFAS, APS, bursaries
- Give specific advice using this student's data
- Keep responses concise: 2-4 sentences for simple questions
- Never invent specific APS cutoffs or deadlines — direct to official sources
- Prospectuses: https://www.querycrest.com/pages/Prospectus
- International students: we do not assist them`;

      const claudeMessages: { role: string; content: string }[] = [];

      const validHistory = (history || []).filter((m: any) =>
        m.id && m.content && m.content.trim() &&
        (m.sender_type === "user" || m.sender_type === "ai")
      ).slice(-12);

      for (const m of validHistory) {
        const role = m.sender_type === "user" ? "user" : "assistant";
        const last = claudeMessages[claudeMessages.length - 1];
        if (last && last.role === role) {
          last.content += "\n" + m.content;
        } else {
          claudeMessages.push({ role, content: m.content });
        }
      }

      if (!claudeMessages.length || claudeMessages[claudeMessages.length - 1].role !== "user") {
        claudeMessages.push({ role: "user", content: message });
      } else {
        claudeMessages[claudeMessages.length - 1].content = message;
      }

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system:     systemPrompt,
          messages:   claudeMessages,
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        console.error("[chatbot] Anthropic error:", anthropicRes.status, errText);
        return new Response(JSON.stringify({
          error: "AI error (" + anthropicRes.status + "): " + errText
        }), { status: 500, headers: corsHeaders });
      }

      const aiData = await anthropicRes.json();
      const reply  = aiData.content?.[0]?.text || "";

      if (!reply) {
        return new Response(JSON.stringify({ error: "Empty AI response" }), {
          status: 500, headers: corsHeaders
        });
      }

      await supabase.from("chat_messages").insert([{
        conversation_id,
        sender_id:   userId,
        sender_type: "ai",
        content:     reply,
        is_read:     false,
      }]);

      return new Response(JSON.stringify({ mode: "ai", reply }), {
        status: 200, headers: corsHeaders
      });
    }

    // ── closeConversation ─────────────────────────────────────────
    if (action === "closeConversation") {
      if (!conversation_id) {
        return new Response(JSON.stringify({ error: "conversation_id required" }), {
          status: 400, headers: corsHeaders
        });
      }
      await supabase
        .from("chat_conversations")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("id", conversation_id);
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 400, headers: corsHeaders
    });

  } catch (err: any) {
    console.error("[chatbot] unhandled error:", err.message);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: corsHeaders
    });
  }
});