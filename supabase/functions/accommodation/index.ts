import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const _SVC = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ===== CONFIGURATION =====
const ALLOWED_ORIGINS = [
  "https://www.querycrest.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://querycrest.com",
];

// ===== CORS HELPERS =====
function getCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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
 .select('id,name,price,location,description,type,accredited,link,opens,closes',{count:'exact'})   
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
  const {data:files,error} = await svc
  .storage.
  from(bucketName)
  .list();

 if(error){
      console.error({error:`failed to retrieve accommodation data, error:${error}`,code:400});
      return _json({error:`failed to retrieve accommodation data, `,data:[]},400);
 }

 if(files) {
      const urls = await Promise.all(
        files.map(async (file)=>{const{data,error} = await svc
      .storage
      .from(bucketName)
    .createSignedUrl(file.name,expiration);
     return {name:file.name,url:data?.signedUrl||null,error:error?.message||null}
    
    })
      );
      
  

      const accommodation_data =accommodations.map(item=>{
        let imageUrls = [];
        //check if links exist in accommodation link column
        if(item.link && item.link.trim() !==''){
          // split by comma
          const links = item.link.split(',').map(l=>l.trim());
          imageUrls = links.filter(link => link !=='');
        }else {
         // find images with same name
         const matchingFiles = urls.filter(file =>{
          const fileName = file.name.toLowerCase();
          const searchName = item.name.toLowerCase();

          // check if the fileNamae constains the search name
          return fileName.includes(searchName)||
                 // check without file extension
                 fileName.replace(/\.[^/.]+$/,'').includes(searchName)||
                 //check if search name is part of the file name
                 searchName.includes(fileName.replace(/\.[^/.]+$/,''));
         });

        // extract urls from matching files
        imageUrls = matchingFiles.map(file => file.url).filter(url => url !==null);
        }
      return{...item,imageUrls:imageUrls};
      });
      //return _json({success:`feedback data retrieved successfuly`,data:urls},200);
      return accommodation_data;
    }
 } catch (_error) {
      //console.error({error:`internal error at accomodation data retrieval, error:${_error}`,code:500});  
      return _json({error:`internal error at accomodation data retrieval, `,data:[]},500);  
 }
}


async function getSearch(svc: ReturnType<typeof _SVC>,query:string,page_idx:number) {

try {
  const pageSize = 15;
  const start_idx = (page_idx-1)*pageSize;
  const end_idx = start_idx+pageSize-1; 

  const column = ['name','price','location','description','type','accredited'];
      for(let i =0;i<column.length;i++){
      const { data, error } = await svc
        .from('accommodation')
        .select('id,name,price,location,description,type,accredited,link,opens,closes')
         .ilike(column[i],`%${query}%`)
        .order('name')
        .range(start_idx,end_idx);

      if (error) {
        return _json({ error: "Search failed" ,data:[]}, 400);
      }
      if(!data)break;

      return  data ;
      }  
} catch (error) {
        return _json({ error: "Search failed" ,data:[]}, 500);  
}      


     }




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return _json("ok");//new Response("ok", { headers: CORS });
  //if (req.method !== "GET") return _json({ error: "Method not allowed" }, 405);
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
    if (method === "POST"){ 
    const auth = await _auth(req);
    if (auth instanceof Response) return auth;
    const { userId:_user_id, email:_email, svc:_svc } = auth;

    }
  

    //path = path.replace(/^\/accommosation\//,'').toLowerCase();
    // get accomodation data
    const svc = _SVC();
    
    if (method === "GET" && path.includes("list")  ) {     
    const page = url.searchParams.get("page") || "1";
    const page_idx:number = Number(page);
    const accommodations  = await getAccommodation(svc,page_idx);
    const data = await getAccommodationImages(svc,accommodations,'accommodation_images',3600);
    return _json({data:data},200);
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
      return _json({data:data},200);
             
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

