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



//only get methods



//hero data

async function getHeroData(svc: ReturnType<typeof _SVC>) {
 try {

  const {data,error} = await svc
 .from('hero_carousel')
 .select('id,url,status,priority',{count:'exact'})
 .eq('status',true)   
 .order('priority',{ascending:true})
 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`hero data not found, error:${error?.message}`,code:404});
      return _json({error:` hero data not found,`,data:[]},404);        
   }
 if(data) {
      return data; //return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later `,data:[]},300);
 }
}






async function getImages(svc: ReturnType<typeof _SVC>,hero_data,bucketName:string,expiration:number = 60) {
 try {
  let offset =0;
  const limit =300;
  const allPaths = [];
  const link_data =[];
  const links =[];
  // cycle thorugh the hero data
  for(let i = 0;i < hero_data.length;i++){
    //check if link doesn't exist ,if yes skip and get links from storage
    if(!hero_data[i].url || hero_data[i].url.length === 0 ||hero_data[i].url === null ){
    while(true){
    const folder = 'hero';
    const {data:files,error} = await svc
    .storage
    .from(bucketName)
    .list(folder,{limit,offset});

   if(error){
        console.error({error:`failed to retrieve hero data, error:${error}`,code:400});
        return _json({error:`failed to retrieve hero data, `,data:[],urls:[]},400);
     }
    if(!files || files.length ===0)break;
    files.sort()
    allPaths.push(...files.map(item=> `${folder}/${item.name}`));
    offset += files.length    
    }
    const urls = await Promise.all(
      allPaths.map((path)=> svc
      .storage
      .from(bucketName)
    .getPublicUrl(path))
    );


    const publicUrls = urls.map((r)=> r.data.publicUrl);
    links.push(...publicUrls);

    //add link to link_data
    link_data.push({folder:'hero',links:publicUrls,TTL:expiration});
    //reset 
    allPaths.length=0;
    links.length=0;
    offset=0;
    }else{
        //add the existing
        link_data.push({folder:'hero',link:hero_data[i].url,order:hero_data[i].priority});
    }
   


  }

    return link_data;
 } catch (_error) {
      console.error({error:`internal error at hero image data retrieval, error:${_error}`,code:500});  
      return _json({error:`internal error , `,data:[],urls:[]},300);  
 }
}







Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return _json("ok");//new Response("ok", { headers: CORS });
  try {

    const origin = req.headers.get("origin");
  if (origin && origin !== "http://127.0.0.1:5500") {
    return _json({ error: "Origin not allowed" }, 403);
  }


  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _json({ error: "Too many attempts. Try again later." }, 429);
  }

    
    const url = new URL(req.url);
    const method = req.method;
    // Proper path extraction
    const path = url.pathname;
  


  // ============================================================
    // GET - Hero images
    // ============================================================
    //     
    const svc = _SVC();

    if (method === "GET" && path.includes("list")  ){     
      const results = await getHeroData(svc);      
      const data = await getImages(svc,results,'hero_images',3600);
      return _json({data:results,urls:data},200);


    }



   else {
        return _json({ error: "API call failed",data:[] }, 400);    
   }

  } catch {
    return _json({ error: "Server error",data:[] }, 300);
  }

});

