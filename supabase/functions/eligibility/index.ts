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


//8KB
const MAX_BODY_SIZE = 8*1024;

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

async function setApsData(svc: ReturnType<typeof _SVC>,data_aps) {
 try {

  const {data,error} = await svc
 .from('eligibility_users')
  .insert([data_aps]);

 if(error){
      //
      console.error({error:`aps insertion data failed, error:${error?.message}`,code:404});
      return _json({error:` aps insertion data failed,`,data:[]},404);        
   }
 if(data) {
      return true; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return _json({error:`Something went wrong. Please try again later `,data:[]},300);
 }
}



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
  if(seen.has(entry.subject) ){
    return true;
  }
  seen.add(entry.subject);
}
return false;
}

function hasDuplicatesMath(subjects){
const subjects_data =[]

for (const entry of subjects){
subjects_data.push(entry.subject);
}
 const lower_Subj = subjects_data.map(item=>item.toLowerCase());
 if(lower_Subj.includes('mathematical literacy') && lower_Subj.includes('mathematics'))return true;
 else return false;
}


//check required subjects
function requiredSubjects(subjects,requirements){
const required_subjects =[];
const missing_subjects =[];
const marks_data = [];
let subj_mark;
let status;
//adding required_subjects
for (const entry of subjects){
    //.includes(entry.subject)
    if(requirements.subject_requirements.required?.some(subject => subject.toLowerCase() === entry.subject.toLowerCase())){
      required_subjects.push(entry.subject);

    }
}
// adding missing_subjects
for (const entry of requirements.subject_requirements.required){
    //!required_subjects?.includes(entry)
    if(!(required_subjects.some(subject =>subject.toLowerCase() ===entry.toLowerCase())))missing_subjects.push(entry);

}

//adding marks_data
for(let i =0 ;i<subjects.length;i++){
   const idx =requirements.subject_requirements.required.findIndex(subj => subj.toLowerCase() === subjects[i].subject.toLowerCase() ) ;
if(!(idx ===-1)){
    subj_mark = requirements.subject_requirements.percentage[idx] ;
    if(subjects[i].mark >=subj_mark)status = "Met";
    else status = "Not Met"  ;
    marks_data.push({student_subject:subjects[i].subject,student_mark:subjects[i].mark,required_mark:subj_mark,status:status});
}

}
return {found:required_subjects,missing:missing_subjects,marks:marks_data};

}


async function getQualifiedQualifications(svc: ReturnType<typeof _SVC>,qualifications:any[],subjects){
  const data = [] 
  for(const item of qualifications){
      const requirements = await getRequirements(svc,item.id);
      if(requirements){
      // not needed
      //if((requirements.minimum_aps ===0 || requirements.minimum_aps === null)||(requirements.minimum_average ===0 || requirements.minimum_average === null))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);
      //if minimum_aps is not null if its null the they dont require the APS
      if(!(requirements.minimum_aps === null)){
      const aps = calculateAps(subjects,requirements)
      

      let required_mark_eligibility;
      
      const found_missing_subj = requiredSubjects(subjects,requirements);
      //return for invalid data 

      if(aps>=requirements.minimum_aps ){

        required_mark_eligibility =true;
        for(const entry of found_missing_subj.marks){
        //return for invalid data 
        //if(!(entry.required_mark >=0 && entry.required_mark <=100))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);

        if(entry.student_mark < entry.required_mark){
          required_mark_eligibility =false;
          }
      }
        if(found_missing_subj.missing.length ===0){
          if(required_mark_eligibility)data.push(item.name)

        }

      }

    }else {
     data.push(item.name)
    }
       
    }

   }
   return data;      
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
      //Reject any body larger than 8 KB to prevent payload attacks. 
      if(body.length > MAX_BODY_SIZE){
          return _json({error:`Request body is too large. Max size is ${MAX_BODY_SIZE/1024} KB`},400);
      }

      
      //Read and parse the JSON request body. 
      const {front_data} = JSON.parse(body);




      const institutionId = front_data.institutionId;
      const qualifictionId = front_data.qualifictionId;
      // return if has duplicates
       if(!institutionId){
        return _json({error:"Select a university/college first  "},400);
       }
        if(typeof institutionId !=="string") return _json({error:'invalid data type ',data:[]},400);

      // return if has dhasInvalidMark
       if(!qualifictionId){
        return _json({error:"Select a qualification first "},400);
       }
        if(typeof qualifictionId !=="string") return _json({error:'invalid data type ',data:[]},400);

      const subjects = front_data.subjects;
      // return if has duplicates
       if(hasDuplicatesSubjects(subjects)){
        return _json({error:"Subject has already been added "},400);
       }
        if(!Array.isArray(subjects)) return _json({error:'invalid data type ',data:[]},400);

       // return if has duplicates maths
       if(hasDuplicatesMath(subjects)){
        return _json({error:"Subjects contains both mathematics and mathematical literacy "},400);
       }
       if(!Array.isArray(subjects)) return _json({error:'invalid data type ',data:[]},400);

      // return if has dhasInvalidMark
       if(hasInvalidMark(subjects)){
        return _json({error:"Please enter a valid mark between 0 and 100  "},400);
       }
   
       if(subjects.length <5){
        return _json({error:"Please add at 5 subjects before checking your eligibility "},400);        
       }else if(subjects.length >10){
        return _json({error:"A maximum of 10 subjects allowed"},400);                
       }       


      const requirements = await getRequirements(svc,qualifictionId);

      //const sources = await getSources(svc ,institutionId);

      //const Subjects = await getSubjects(svc);
       
      //const qualifications = await   getQualifications(svc ,institutionId);
       //       
      if(requirements){
      // not needed
      //if((requirements.minimum_aps ===0 || requirements.minimum_aps === null)||(requirements.minimum_average ===0 || requirements.minimum_average === null))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);
      //if minimum_aps is not null if its null the they dont require the APS
      if(!(requirements.minimum_aps === null)){
      const aps = calculateAps(subjects,requirements)
      
      const average = aps/subjects.length;
      let eligibility;
      let required_mark_eligibility;
      let reasons;
      let aps_r;
      let req_details = "";

      const found_missing_subj = requiredSubjects(subjects,requirements);
      //return for invalid data 

      if(aps>=requirements.minimum_aps ){
        eligibility=true;
        required_mark_eligibility =true;
        for(const entry of found_missing_subj.marks){
        //return for invalid data 
        if(!(entry.required_mark >=0 && entry.required_mark <=100))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);

        req_details += `\nsubject:${entry.student_subject} | student mark:${entry.student_mark} | required mark:${entry.required_mark} | status:${entry.status}`
        if(entry.student_mark < entry.required_mark){
          eligibility =false;
          required_mark_eligibility =false;
          }
      }
        if(found_missing_subj.missing.length ===0){
          if(required_mark_eligibility)reasons= `you have passed the minimum required APS  with required subjects :${found_missing_subj.found} , Requirements: ${req_details}`;
          else reasons= `you have passed the minimum required APS but failed to reach  required subject mark , required subjects :${found_missing_subj.found} , Requirements: ${req_details}`;
        }
        else reasons= `you have passed the minimum required APS  with required subjects :${found_missing_subj.found} but you are missing these subjects to quliafy for the qualification :${found_missing_subj.missing} , Requirements: ${req_details}`

      }
      else{

       eligibility = false; 
        for(const entry of found_missing_subj.marks){
        //return for invalid data 
        if(!(entry.required_mark >=0 && entry.required_mark <=100))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);          
        req_details += `\nsubject:${entry.student_subject} | student mark:${entry.student_mark} | required mark:${entry.required_mark} | status:${entry.status}`
        }
       if(found_missing_subj.missing.length ===0)reasons= `you have failed to reach the minimum required APS  with required subjects :${found_missing_subj.found} , Requirements: ${req_details}`;
        else reasons= `you have failed to reach the minimum required APS  with required subjects :${found_missing_subj.found} but you are also missing these subjects to quliafy for the qualification :${found_missing_subj.missing} , Requirements: ${req_details}`

      }
      
      let minimum_average_d;
      if(requirements.minimum_average ===null)minimum_average_d = 'no average';
      else minimum_average_d = requirements.minimum_average;
       if(aps>100){
        aps_r = `Calculated APS: ${aps} FPS, minimum APS: ${requirements.minimum_aps } FPS , average APS: ${minimum_average_d} FPS`
       }else  aps_r = `Calculated APS: ${aps}, minimum APS: ${requirements.minimum_aps } , average APS: ${minimum_average_d}`
       const requirement = `${aps_r} and required subjects: ${requirements.subject_requirements.required} `;
       let alt = null;
       if(!eligibility||!required_mark_eligibility){
        const qualifications =[]
        const qualifications_data =  await   getQualifications(svc ,institutionId);
        for(const item of qualifications_data){
          qualifications.push(item)
        }
        alt = getQualifiedQualifications(svc,qualifications,subjects);
        }

       const data = {aps:aps,average:average,eligibility:eligibility,reasons:reasons,requirements:requirement}
       //add record
       await setApsData(svc,data);
       const data_d = {...data,alt:alt}
       return _json({ error: "",data:data_d}, 200);

    }else {

      let eligibility;
      let required_mark_eligibility;
      let reasons;

      let req_details = "";

      const found_missing_subj = requiredSubjects(subjects,requirements);
              //return for invalid data 

      
        eligibility=true;
        required_mark_eligibility =true;
        for(const entry of found_missing_subj.marks){
        //return for invalid data 
        if(!(entry.required_mark >=0 && entry.required_mark <=100))       return _json({ error: "We cannot verify eligibility for this qualification yet because the required admission data is unavailable",data:[]}, 400);

        req_details += `\nsubject:${entry.student_subject} | student mark:${entry.student_mark} | required mark:${entry.required_mark} | status:${entry.status}`
        if(entry.student_mark < entry.required_mark){
          eligibility =false;
          required_mark_eligibility =false;
          }
      }
        if(found_missing_subj.missing.length ===0){
          if(required_mark_eligibility)reasons= `No APS required ,required subjects :${found_missing_subj.found} , Requirements: ${req_details}`;
          else reasons= `No APS required but failed to reach  required subject mark , required subjects :${found_missing_subj.found} , Requirements: ${req_details}`;
        }
        else reasons= `No APS required , required subjects :${found_missing_subj.found} but you are missing these subjects to quliafy for the qualification :${found_missing_subj.missing} , Requirements: ${req_details}`

      

      

       const requirement = `Required subjects: ${requirements.subject_requirements.required} `;
       const data = {aps:0,average:0,eligibility:eligibility,reasons:reasons,requirements:requirement}
       //add record
       await setApsData(svc,data);       
       return _json({ error: "",data:data}, 200);

    }
       
    }

    } catch  {
          return _json({ error: `server error APS calculation  failed `,data:[] }, 300);        
      }
   }
   else {
        return _json({ error: "API call failed",data:[] }, 400);    
   }

  } catch {
    return _json({ error: "Server error",data:[] }, 300);
  }
});

