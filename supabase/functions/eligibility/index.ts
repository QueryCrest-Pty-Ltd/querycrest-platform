import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { error } from "node:console";

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


//only get methods

//institutions 

async function getInstitutions(svc: ReturnType<typeof _SVC>) {
 try {

  const {data,error} = await svc
 .from('institutions')
 .select('id,name,abbreviation,type,province,website,prospectus_url,prospectus_year,active',{count:'exact'})
 .eq('active',true)

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`institution data not found, error:${error?.message}`,code:404});
      return _json({error:` institution data not found,`,data:[]},404);        
   }
 if(data) {

      return data;      //return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later, error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later, `,data:[]},300);
 }
}


//qualifications 
async function getQualifications(svc: ReturnType<typeof _SVC>,identifier:string) {
 try {

  const {data,error} = await svc
 .from('qualifications')
 .select('   id,institution_id,name,code,nqf_level,duration,faculty,active,metadata ',{count:'exact'})
 .eq(`institution_id`,identifier)   

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`qualification data not found, error:${error?.message}`,code:404});
      return _json({error:`Qualification could not be found,`,data:[]},404);        
   }
 if(data) {
      return data;      //return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later, error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later, `,data:[]},300);
 }
}

//course_requirements 
async function getRequirements(svc: ReturnType<typeof _SVC>,identifier:string) {
 try {

  const {data,error} = await svc
 .from('course_requirements ')
 .select(' id,qualification_id,prospectus_year,minimum_aps,minimum_average,subject_requirements,admission_rules,calculation_rules,source_id,active ',{count:'exact'})
 .eq(`qualification_id`,identifier)   
 .single();

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`Eligibility cannot be verified , error:${error?.message}`,code:404});
      return _json({error:` Eligibility cannot be verified ,`,data:[]},404);        
   }
 if(data) {
            return data;//return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later, error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later, `,data:[]},300);
 }
}

//subjects 
async function getSubjects(svc: ReturnType<typeof _SVC>) {
 try {

  const {data,error} = await svc
 .from('subjects')
 .select('id,name,active',{count:'exact'})   

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`subject data not found, error:${error?.message}`,code:404});
      return _json({error:` subject data not found,`,data:[]},404);        
   }
 if(data) {
       return data;

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later `,data:[]},300);
 }
}
//sources 

async function getSources(svc: ReturnType<typeof _SVC>,identifier:string) {
 try {

  const {data,error} = await svc
 .from('sources')
 .select('id,institution_id,source_url,document_name,document_year,verification_status,verified_at,extraction_date,notes',{count:'exact'})
 .eq(`institution_id`,identifier)   

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`source data not found, error:${error?.message}`,code:404});
      return _json({error:` source data not found,`,data:[]},404);        
   }
 if(data) {
      return data; //return _json ({data:data},200);

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later `,data:[]},300);
 }
}


//ELIGIBILITY ENGINE 
/*
APS 
Average 
LO Rules 
Subject Rules 
Eligibility 
*/

/*

{
  "required": ["Mathematics", "Physical Sciences", "Life Sciences"],
  "percentage": [0, 0, 0],
  "life_orientation_excluded": true,
  "special": {
    "English": {
      "required": true,
      "home_language_minimum": 50,
      "first_additional_language_minimum": 60
    }
  }
}

*/


/*
const require =  {
  "required": ["English", "Mathematics", "Physical Sciences"],
  "percentage": [0, 0, 0],
  "life_orientation_excluded": true,
  "special": {
    "mathematics_lit": {
      "percentage": 60,

    },
    "language":{
    "english_first": {
      "percentage": 50,

    }

  }

 }
}

const idx = 0;
require.required[idx];
require.percentage[idx];
const lo_ex = require.life_orientation_excluded;


*/

/*
17. Eligibility Engine
The backend must evaluate all relevant requirements. At minimum:
•
Check 1: Does the course exist? |done
•
Check 2: Is the institution active? |done
•
Check 3: Are course requirements available? |done
•
Check 4: Does the student have the required number of subjects? |?
•
Check 5: Are subjects unique? | done
•
Check 6: Are all marks valid? | done
•
Check 7: Calculate APS. | almost
•
Check 8: Calculate average. |done
•
Check 9: Apply institution 
-
specific APS rules. | not done
•
Check 10: Apply subject minimums. | done
•
Check 11: Apply subject combinations. | not done
•
Check 12: Apply LO rules. | almost
•
Check 13: Apply Mathematics/Mathematical Literacy rules. | not done
•
Check 14: Determine final eligibility. | done
•
Check 15: Generate human 
-
readable reasons.| almost
*/

//calculate aps
function calculateAps(subjects,requirement_data){
 let aps = 0
 
  for (const entry of subjects){
    // check if life orientation
    //&& minimum_aps.subject_requirements.required.includes(entry.subject)
    if(requirement_data.subject_requirements.life_orientation_excluded && !entry.subject.toLowerCase().includes('life orientation') ){
      // if the mini aps is <100 else use fps 
      if(requirement_data.minimum_aps <100){
      if(entry.mark <29)aps = aps + 1;
      else if(entry.mark <39)aps = aps +2;
      else if(entry.mark <49)aps = aps + 3;
      else if(entry.mark <59)aps = aps + 4;
      else if(entry.mark <69)aps = aps + 5;
      else if(entry.mark <79)aps = aps + 6;
      else if(entry.mark >79)aps = aps + 7;
      }else aps = aps + entry.mark;
    }

}

return aps;
}


//check Invalid Mark
function hasInvalidMark(subjects){
for (const entry of subjects){
  if(entry.mark <0 || entry.mark >100){
    return true;
  }

}
return false;
}



//check Duplicates subjects
function hasDuplicatesSubjects(subjects){
const seen = new Set();
for (const entry of subjects){
  if(seen.has(entry.subject)){
    return true;
  }
  seen.add(entry.subject);
}
return false;
}

//check required subjects
function requiredSubjects(subjects,requirements){
const required_subjects =[];
const missing_subjects =[];

for (const entry of subjects){
    //.includes(entry.subject)
    if(requirements.subject_requirements.required?.some(subject => subject.toLowerCase() === entry.subject.toLowerCase()))required_subjects.push(entry.subject);

}
for (const entry of requirements.subject_requirements.required){
    //!required_subjects?.includes(entry)
    if(!(required_subjects.some(subject =>subject.toLowerCase() ===entry.toLowerCase())))missing_subjects.push(entry);

}

return {found:required_subjects,missing:missing_subjects};

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
    // GET - Institutions
    // ============================================================
    //     
    const svc = _SVC();

    if (method === "GET" && path.includes("list")  ){     
      const data = await  getInstitutions(svc);

      return _json({data:data},200);


    }

      // ============================================================
    // GET - Subjects
    // ============================================================
    //     

    if (method === "GET" && path.includes("subjects")  ){     
      const data = await  getSubjects(svc);

      return _json({data:data},200);


    }

  // ============================================================
    // GET - Qualifications
    // ============================================================
    //     

    if (method === "GET" &&   path.includes("qualifications")) {     
    const institutionId = url.searchParams.get("identifier") || "";
      if(typeof institutionId  === 'string'){
      const data =  await   getQualifications(svc ,institutionId);
      return _json({data:data},200);
      }
      else return _json({error:'invalid data type ',data:[]},400);
     
    }

    

  // ============================================================
    // PUT - Calculate aps
    // ============================================================
     else if (method === "PUT" ){
      try{
      const body = await req.text();
      //Read and parse the JSON request body. 
      //const {action,first_name,last_name,email,phone,password,user_id} = await req.json();
      const {front_data} = JSON.parse(body);
       //if(typeof front_data==="object" ){
      /*
      { 
      “institutionId”: “institution-id”, 
      “qualifictionId”: “qualification-id”, 
      “subjects”: [ 
      { 
      “subject”: “Mathematics”, 
      “mark”: 75 
      }, 
      { 
      “subject”: “English’, 
      “mark”: 68 
      } 
      ] 
      } 
*/

      const institutionId = front_data.institutionId;
      const qualifictionId = front_data.qualifictionId;
      // return if has duplicates
       if(!institutionId){
        return _json({error:"Select a university/college first  "},400);
       }//else if(typeof institutionId ==="string") return _json({error:'invalid data type ',data:[]},400);

      // return if has dhasInvalidMark
       if(!qualifictionId){
        return _json({error:"Select a qualification first "},400);
       }//else if(typeof qualifictionId ==="string") return _json({error:'invalid data type ',data:[]},400);

      const subjects = front_data.subjects;
      // return if has duplicates
       if(hasDuplicatesSubjects(subjects)){
        return _json({error:"Subject has already been added "},400);
       }//else if(Array.isArray(subjects)) return _json({error:'invalid data type ',data:[]},400);

      // return if has dhasInvalidMark
       if(hasInvalidMark(subjects)){
        return _json({error:"Please enter a valid mark between 0 and 100  "},400);
       }
   
       if(subjects.length <5){
        return _json({error:"Please add at 5 subjects before checking your eligibility "},400);        
       }else if(subjects.length >10){
        return _json({error:"A maximum of 10 subjects allowed"},400);                
       }       
     // const subject = data.subjects[].subject;
      //const subject_mark = data.subjects[].mark;
      

      const requirements = await getRequirements(svc,qualifictionId);

      //const sources = await getSources(svc ,institutionId);

      //const Subjects = await getSubjects(svc);
       
      //const qualifications = await   getQualifications(svc ,institutionId);
       //       
      if(requirements){
      const aps = calculateAps(subjects,requirements)
      
      const average = aps/subjects.length;
      let eligibility;
      let reasons;
      let aps_r;
      const found_missing_subj = requiredSubjects(subjects,requirements);

      if(aps>=requirements.minimum_aps ){
        eligibility=true;
        if(found_missing_subj.missing.length ===0)reasons= `you have passed the minimum required APS  with required subjects :${found_missing_subj.found}`;
        else reasons= `you have passed the minimum required APS  with required subjects :${found_missing_subj.found} but you are missing these subjects to quliafy for the qualification :${found_missing_subj.missing}`

      }
      else{

       eligibility = false; 
        if(found_missing_subj.missing.length ===0)reasons= `you have failed to reach the minimum required APS  with required subjects :${found_missing_subj.found}`;
        else reasons= `you have failed to reach the minimum required APS  with required subjects :${found_missing_subj.found} but you are also missing these subjects to quliafy for the qualification :${found_missing_subj.missing}`

      }
      
      let minimum_average;
      if(requirements.minimum_average ===null)minimum_average = 'no average';
      else minimum_average = requirements.minimum_average;
       if(aps>100){
        aps_r = `Calculated APS: ${aps} FPS, minimum APS: ${requirements.minimum_aps } FPS , average APS: ${minimum_average} FPS`
       }else  aps_r = `Calculated APS: ${aps}, minimum APS: ${requirements.minimum_aps } , average APS: ${minimum_average}`
       const requirement = `${aps_r} and required subjects: ${requirements.subject_requirements.required} `;
       const data = {aps:aps,average:average,eligibility:eligibility,reasons:reasons,requirements:requirement}
       
       return _json({ error: "",data:data}, 200);


       
    }
    //} else return _json({error:'invalid data type ',data:[]},400); 
       //return _json({ error: "",data:requirements }, 200);
    } catch(error)  {
          return _json({ error: `server error APS calculation  failed ${error}`,data:[] }, 300);        
      }
   }
   else {
        return _json({ error: "function call failed",data:[] }, 400);    
   }

  } catch {
    return _json({ error: "Server error",data:[] }, 300);
  }
});

