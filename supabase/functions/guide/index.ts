import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);



// ===== CORS HELPERS =====
function getCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5500",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
function _json(body: unknown, status = 200,origin: string | null = null): Response {
  const corsHeaders = getCorsHeaders(origin);
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}




// Rate limiting: track attempts by IP
const attemptMap = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT = 5; // max attempts per IP per window
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = attemptMap.get(ip);

  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    attemptMap.set(ip, { count: 1, timestamp: now });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}



//get guide data
async function getGuide(svc: ReturnType<typeof _SVC>,page_idx:number,page:string) {
 try {
  const limit = 5;
  const start_idx = (page_idx-1)*limit;
  const end_idx = start_idx+limit-1;

  const {data,error} = await svc
 .from('guide')
 .select('step,target,direction,page,title,content,function_,top_position_mb,left_position_mb,top_position_p_mb,left_position_p_mb,top_position_tb,left_position_tb,top_position_p_tb,left_position_p_tb,top_position_pc,left_position_pc,top_position_p_pc,left_position_p_pc,last_item',{count:'exact'})
 .eq('page',page)   
 .order('step',{ascending:true})
 .range(start_idx,end_idx);

 if(error||!data){
      //
      console.error({error:`failed to retrieve guide data, error:${error.message}`,code:400});
      return _json({error:`failed to retrieve guide data,`,data:[]},400);        
   }
 if(data) {
      return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`internal error at guide data retrieval, error:${_error}`,code:500});  
      return _json({error:`internal error at guide data retrieval, `,data:[]},500);
 }
}
//get guide user data
async function getGuideUsers(svc: ReturnType<typeof _SVC>,identifier_type:string,identifier:string) {
 try {

  const {data,error} = await svc
 .from('guide_users')
 .select('first_time,complete,step_current,username,email,role',{count:'exact'})
 .eq(`${identifier_type}`,identifier)   
 .single();

 if(error||!data){
      //
      console.error({error:`failed to retrieve guide data, error:${error.message}`,code:400});
      return _json({error:`failed to retrieve guide data,`,data:[]},400);        
   }
 if(data) {
      return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`internal error at guide data retrieval, error:${_error}`,code:500});  
      return _json({error:`internal error at guide data retrieval, `,data:[]},500);
 }
}

//update users data
async function setGuideUsers(svc: ReturnType<typeof _SVC>,identifier_type:string,identifier:string,page:string,_update) {
 try {


  const {data,error} = await svc
 .from('guide_users')
 .update(_update)
 //.eq('page',page)   
 .eq(`${identifier_type}`,identifier)
 .select();
 if(error){
      //
      console.error({error:`failed to retrieve guide data, error:${error?.message}`,code:400});
      return _json({error:`failed to retrieve guide data,`,data:[]},400);        
   }
 if(data) {
      return _json ({success:true,data:data},200);

    }
 } catch (_error) {
      console.error({error:`internal error at guide data update, error:${_error}`,code:500});  
      return _json({error:`internal error at guide data update, `,data:[]},500);
 }
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return _json("ok");//new Response("ok", { headers: CORS });
  try {
/*
    const origin = req.headers.get("origin");
  if (origin && origin !== "https://www.querycrest.com") {
    return _json({ error: "Origin not allowed" }, 403);
  }


  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _json({ error: "Too many attempts. Try again later." }, 429);
  }
  */
    
    const url = new URL(req.url);
    const method = req.method;
    // Proper path extraction
    const path = url.pathname;
  


  // ============================================================
    // GET - guide
    // ============================================================
    //     
    const svc = _SVC();

    if (method === "GET" && path.includes("list")  ) {     
    const page = url.searchParams.get("page") || "";
    const limit = url.searchParams.get("limit") || "1";
    const page_idx:number = Number(limit);
    return await getGuide(svc,page_idx,page);

    }
  
  // ============================================================
    // GET - guide user
    // ============================================================
    //     

    if (method === "GET" &&   path.includes("users")) {     
    const identifier = url.searchParams.get("identifier") || "";
    const identifier_type = url.searchParams.get("identifier_type") || "username";

    return await getGuideUsers(svc,identifier_type,identifier);

    }

    

  // ============================================================
    // PUT - set guide users
    // ============================================================
     else if (method === "PUT" ){
      try{
      const body = await req.text();
      //Read and parse the JSON request body. 
      //const {action,first_name,last_name,email,phone,password,user_id} = await req.json();
      const {first_time,complete,step_current,email,username,page} = JSON.parse(body);

      let _update = {};
    
      if(first_time)_update = {..._update,first_time:first_time};
      if(complete)_update = {..._update,complete:complete};
      if(step_current)_update = {..._update,step_current:step_current};  
      let identifier = '';          
      let identifier_type = 'username';          

      if(email){
        identifier = email;
        identifier_type ="email"
        }
      if(username){
       identifier = username;            
       identifier_type ="username"
      }
      return await setGuideUsers(svc,identifier_type,identifier,page,_update);

    } catch  {
          return _json({ error: "server error guide update failed",data:[] }, 500);        
      }
   }
   else {
        return _json({ error: "function call failed",data:[] }, 400);    
   }

  } catch {
    return _json({ error: "Server error",data:[] }, 500);
  }
});

