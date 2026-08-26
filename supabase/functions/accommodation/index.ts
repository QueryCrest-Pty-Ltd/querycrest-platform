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
async function _auth(req: Request): Promise<{ userId: string; email: string; svc: ReturnType<typeof _SVC> } | Response> {
  let token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  if (!token) {
    const cookies = req.headers.get("cookie") ?? "";
    const match   = cookies.match(/(?:^|;\s*)access_token=([^;]+)/);
    token         = match?.[1]?.trim();
  }
  if (!token) return _json({ error: "Unauthorized" }, 401);

  const svc = _SVC();
  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) return _json({ error: "Unauthorized — invalid token" }, 401);
  return { userId: user.id, email: user.email ?? "", svc };
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




async function getAccommodation(svc: ReturnType<typeof _SVC>,page_idx:number) {
 try {
  const pageSize = 15;
  const start_idx = (page_idx-1)*pageSize;
  const end_idx = start_idx+pageSize-1;

  const {data,error} = await svc
 .from('accommodation')
 .select('id,name,university_name,price,location,description,type,accredited,link,opens,closes',{count:'exact'})   
 .order('id',{ascending:true})
 .range(start_idx,end_idx);

 if(error){
      //
      console.error({error:`failed to retrieve accommodation data, error:${error.message}`,code:400});
      return _json({error:`failed to retrieve accommodation data,`,data:[]},400);        
   }
 if(data) {
      return data//_json({success:`feedback data retrieved successfuly`,data:data},200);

    }
 } catch (_error) {
      console.error({error:`internal error at accomodation data retrieval, error:${_error}`,code:500});  
      return _json({error:`internal error at accomodation data retrieval, `,data:[]}),500;
 }
}


async function getAccommodationImages(svc: ReturnType<typeof _SVC>,accommodations,bucketName:string,expiration:number = 60) {
 try {
  let offset =0;
  const limit =300;
  const allPaths = [];
  const link_data =[];
  const links =[];
  // cycle thorugh the accommodations getting names as folder path
  for(let i = 0;i < accommodations.length;i++){
    //check if link doesn't exist ,if yes skip and get links from storage
    if(!accommodations[i].link.urls || accommodations[i].link.urls === "[]" ||accommodations[i].link.urls === null ){
    while(true){
    const folder = accommodations[i].name;
    const {data:files,error} = await svc
    .storage
    .from(bucketName)
    .list(folder,{limit,offset});

   if(error){
        console.error({error:`failed to retrieve accommodation data, error:${error}`,code:400});
        //return _json({error:`failed to retrieve accommodation data, `,data:[]},400);
        return []
     }
    if(!files || files.length ===0)break;
    allPaths.push(...files.map(item=> `${folder}/${item.name}`));
    offset += files.length    
    }
    const urls = await Promise.all(
      allPaths.map((path)=> svc
      .storage
      .from(bucketName)
    .getPublicUrl(path))
    );

    /*const{data} = await svc
      .storage
      .from(bucketName)
    .getPublicUrl(allPaths);
    if(data){
    for(let k=0 ; k<data?.length; k++){
    links.push(data?.[k]?.signedUrl||[]);
    }*/
    const publicUrls = urls.map((r)=> r.data.publicUrl);
    links.push(...publicUrls);
    //}
    //add link to link_data
    link_data.push({folder:accommodations[i].name,links:publicUrls});
    //reset allPaths
    allPaths.length=0;
    links.length=0;
    offset=0;
    }else{
        //add the existing
        link_data.push({folder:accommodations[i].name,links:accommodations[i].link.urls});
    }
   


  }

    return link_data;
 } catch (_error) {
      //console.error({error:`internal error at accomodation data retrieval, error:${_error}`,code:500});  
      //return _json({error:`internal error at accomodation data retrieval, `,data:[]},500);  
        return [];
 }
}


async function getSearch(svc: ReturnType<typeof _SVC>,query:string,page_idx:number) {

try {
  const pageSize = 15;
  const start_idx = (page_idx-1)*pageSize;
  const end_idx = start_idx+pageSize-1; 

  const column = ['name','university_name','location','description'];
  //const column = ['name','university_name','price','location','description','type','accredited','opens','closes'];
  const search =[];
  const filter = column.map(c=> `${c}.ilike.*${query}*`).join(',')
  //for(let i =0;i<column.length;i++){
      const { data, error } = await svc
        .from('accommodation')
        .select('id,name,university_name,price,location,description,type,accredited,link,opens,closes')
        .or(filter)
        .order('name')
        .range(start_idx,end_idx);

      if (error) {
        return [{ error: `Search failed error ${error.message}`}];;
      }
      return data;
      //search.push(...data);
      //}
    //return search;  
} catch (error) {
        //return _json({ error: "Search failed" ,data:[]}, 500);
        return [{ error: "Search failed"}];  
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
*/

  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return _json({ error: "Too many attempts. Try again later." }, 429);
  }
  
    
    const url = new URL(req.url);
    const method = req.method;
    // Proper path extraction
    const path = url.pathname;
  

    //path = path.replace(/^\/accommosation\//,'').toLowerCase();
    // get accomodation data
    const svc = _SVC();

    if (method === "GET" && path.includes("list")  ) {     
    const page = url.searchParams.get("page") || "1";
    const page_idx:number = Number(page);
    const accommodations  = await getAccommodation(svc,page_idx);
    const data = await getAccommodationImages(svc,accommodations,'accommodation_images',3600);
    return _json({data:accommodations,urls:data},200);
    }
  

  // ============================================================
    // GET - Search
    // ============================================================
     else if (method === "GET" && path.includes("search") ){
      try{
      const query = url.searchParams.get("q") || "";
      

      if (!query.trim()) {
        return _json({ error: "Search query required" }, 400);
      }
      const page = url.searchParams.get("page") || "1";
      const page_idx:number = Number(page);

      const results = await getSearch(svc,query,page_idx);      
      const data = await getAccommodationImages(svc,results,'accommodation_images',3600);
      return _json({data:results,urls:data},200);
             
      } catch  {
          return _json({ error: "server error Search failed",data:[] }, 500);        
      }
   }
   else {
        return _json({ error: "function call failed",data:[] }, 400);    
   }

  } catch {
    return _json({ error: "Server error",data:[] }, 500);
  }
});

