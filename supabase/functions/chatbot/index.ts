
import Anthropic, { HUMAN_PROMPT } from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { customAlphabet } from 'npm:nanoid@5';
import validator from "npm:validator";
// Define allowed characters and length
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nanoid20 = customAlphabet(alphabet, 20);

let chat_index = -1;
let current_chat_history;
const supabase_client = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const chatbot_client = new Anthropic({
  apiKey:Deno.env.get("ANTHROPIC-API-KEY-PUBLIC")
})

let human_agent = false;
// ===== CORS HELPERS =====
function getCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5500",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, origin",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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


const API_BASE = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1";
const SUBJECTS = [];
const UNIVERSITIES = [];
const QUALIFICATIONS = [];

//only get methods
 //settings

async function getSources(spbase_client: ReturnType<typeof supabase_client>,identifier:string) {
 try {

  const {data,error} = await spbase_client
 .from('sources')
 .select('id,institution_id,source_url,document_name,document_year,verification_status,verified_at,extraction_date,notes',{count:'exact'})
 .eq(`institution_id`,identifier)   

 if(error||Object.keys(data).length ===0){
      //
      console.error({error:`source data not found, error:${error?.message}`,code:404});
      return {error:` source data not found,`,data:[],code:404};        
   }
 if(data) {
      return {error:"",data:data,code:200};

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error}`,data:[],code:300};
 }
}


 //history
async function getSettings(spbase_client: ReturnType<typeof supabase_client>) {
 try {

  const {data,error} = await spbase_client
 .from('chatbot_setting')
 .select('id,chat_tokens,model,system_prompt,manual_models,adaptive_thinking,manual_thinking,manual_models',{count:'exact'})
 .single()
 if(error){
      //
      console.error({error:`chatbot settings data not found, error:${error?.message}`,code:404});
      return {error:` chatbot settings data not found,`,data:[],code:404};        
   }
 if(data) {
      return {error:"",data:data,code:200};

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error} `,data:[],code:300};
 }
}
 //sources 

async function getChatHistory(spbase_client: ReturnType<typeof supabase_client>,first_name:string,surname:string,email:string) {
 try {

  const {data,error} = await spbase_client
 .from('chatbot_histories')
 .select('id,first_name,surname,email,role,chat,abuse_flag,abuse_count,abuse_max_count,abuse_description',{count:'exact'})
 .eq(`email`,email)   
 .single()

  if(!data){
      const {data:new_data,error:insert_error} = await spbase_client
      .from('chatbot_histories')
      .insert([{'first_name':first_name,'surname':surname,'email':email,'role':'user'}])
      .select()
      .eq(`email`,email)   
      .single();

    if(insert_error){
          //
          console.error({error:`chatbot history insertion data failed, error:${error?.message}`,code:404});
          return {error:` chatbot history insertion data failed,`,data:{},code:404};        
      } 
    if(new_data) {
          const {chat,...data_without_chat } =new_data; 

          let history = [];
          if (Array.isArray(chat.history))history=chat.history;
 


          return {error:"",data:{...data_without_chat,chat:history},code:200};
        }      
      
  }
 if(error){
      

      console.error({error:`chat history data not found, error:${error?.message}`,code:404});
      return {error:` chat history data not found,`,data:{},code:404};        
   }
 if(data) {
      const {chat,...data_without_chat } =data; 



      let history = [];
      if (Array.isArray(chat.history))history=chat.history;



      return {error:"",data:{...data_without_chat,chat:history},code:200};
    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error} `,data:{},code:300};
 }
}

//role
async function getChatRole(spbase_client: ReturnType<typeof supabase_client>,email:string) {
 try {

  const {data,error} = await spbase_client
 .from('chatbot_histories')
 .select('id,first_name,surname,email,role',{count:'exact'})
 .eq(`email`,email)   
 .single()


 if(error){
      

      console.error({error:`chat history data not found, error:${error?.message}`,code:404});
      return {error:` chat history data not found,`,data:{},code:404};        
   }
 if(data) {
      return {error:"",data:data,code:200};
    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error} `,data:{},code:300};
 }
}


async function getChatFqa(spbase_client: ReturnType<typeof supabase_client>) {
 try {

  const {data,error} = await spbase_client
 .from('chatbot_faq')
 .select('account_management ,billing_payments,university_applications ,college_applications,bursaries,document_upload,application_management,accommodation,technical_issues,general_support',{count:'exact'})
 .single()


 if(error){
      

      console.error({error:`Frequently Questioned Answers data not found, error:${error?.message}`,code:404});
      return {error:` Frequently Questioned Answers data not found,error ${error.message}`,data:{},code:404};        
   }
 if(data) {
      return {error:"",data:data,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error}`,data:{},code:300};
 }
}


async function addChat(spbase_client: ReturnType<typeof supabase_client>,chat,email) {
 try {

  const {data,error} = await spbase_client
  .from('chatbot_histories')
  .update([{'chat':{history:chat} }])
  .eq(`email`,email);   

  if(error){
      //
      console.error({error:`adding chat data failed, error:${error?.message}`,code:404});
      return {error:` adding chat data failed,${error.message}`,data:{},code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error}`,data:{},code:300};
 }
}

async function addUser_ChatLog(spbase_client: ReturnType<typeof supabase_client>,log,email) {
 try {

  const {data,error} = await spbase_client
  .from('chatbot_histories')
  .update([log])
  .eq(`email`,email);   

  if(error){
      //
      console.error({error:`adding chat user log data failed, error:${error?.message}`,code:404});
      return {error:` adding chat user log data failed,${error.message}`,data:{},code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error}`,data:{},code:300};
 }
}


async function addChat_timeStamp(spbase_client: ReturnType<typeof supabase_client>,timeHistory,email) {
 try {

  const {data,error} = await spbase_client
  .from('chatbot_histories')
  .update([{'response_time':{history:timeHistory} }])
  .eq(`email`,email);   

  if(error){
      //
      console.error({error:`adding chat time stamp data failed, error:${error?.message}`,code:404});
      return {error:` adding chat time stamp data failed,${error.message}`,data:{},code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error}`,data:{},code:300};
 }
}

async function getChatTimeHistory(spbase_client: ReturnType<typeof supabase_client>,email:string) {
 try {

  const {data,error} = await spbase_client
 .from('chatbot_histories')
 .select('response_time',{count:'exact'})
 .eq(`email`,email)   
 .single()

 if(error){
      

      console.error({error:`chat time history data not found, error:${error?.message}`,code:404});
      return {error:` chat time history data not found,`,data:{},code:404};        
   }
 if(data) {




      return {error:"",data:data,code:200};
    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later error ${_error} `,data:{},code:300};
 }
}


async function addChat_log(spbase_client: ReturnType<typeof supabase_client>,_data) {
 try {

  const {data,error} = await spbase_client
  .from('chatbot_log')
  .insert([_data])
  .select();  
   

  if(error){
      //
      console.error({error:`adding chat data failed, error:${error?.message}`,code:404});
      return {error:` adding chat data failed, ${error.message}`,data:[],code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later  error ${_error}`,data:[],code:300};
 }
}


//ticket
async function addChat_ticket(spbase_client: ReturnType<typeof supabase_client>,_data) {
 try {

  const {data,error} = await spbase_client
  .from('chatbot_ticket')
  .insert([_data])
  .select();
   

  if(error){
      //
      console.error({error:`adding chat ticket data failed, error:${error?.message}`,code:404});
      return {error:` adding chat ticket data failed, ${error.message}`,data:false,code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later  error ${_error}`,data:false,code:300};
 }
}

async function setChat_ticket(spbase_client: ReturnType<typeof supabase_client>,_data) {
 try {
  const {email ,ticket_id, ...without_email} = _data;
  const {data,error} = await spbase_client
  .from('chatbot_ticket')
  .update([without_email])
  .eq('email',email)
  .eq('ticket_id',ticket_id);
  if(error){
      //
      console.error({error:`adding chat ticket data failed, error:${error?.message}`,code:404});
      return {error:` updating chat ticket data failed, ${error.message}`,data:false,code:404};       
   }
 if(data) {
      return {error:"",data:true,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later  error ${_error}`,data:false,code:300};
 }
}

async function getChat_tickets(spbase_client: ReturnType<typeof supabase_client>,_data) {
 try {
  const {email ,ticket_id, ...without_email} = _data;
  const {data,error} = await spbase_client
  .from('chatbot_ticket')
  .select('ticket_id,username,email,chat_index,human_agent,subject,description,status,priority,solved_at,due_at',{count:'exact'})
  .eq('email',email)

  if(error){
      //
      console.error({error:`getting chat ticket data failed, error:${error?.message}`,code:404});
      return {error:` getting chat ticket data failed, ${error.message}`,data:[],code:404};       
   }
 if(data) {
      return {error:"",data:data,code:200}; 

    }
 } catch (_error) {
      console.error({error:`Something went wrong. Please try again later , error:${_error}`,code:300});  
      return {error:`Something went wrong. Please try again later  error ${_error}`,data:[],code:300};
 }
}

 // accommodation urls
  async function getAccommodations(endpoint) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {error:'failed to fetch accommodations data',data:[]};
    }
  }

  // elegibility functions
  async function getInstitutions(endpoint) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {error:'failed to fetch institutions data',data:[]};
    }
  }

  async function getSubjects(endpoint) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {error:'failed to fetch subjects data',data:[]};
    }
  }

  async function getQualifications(endpoint) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      return data;
    } catch (error) {
      return {error:'failed to fetch qualifications data',data:[]};
    }
  }

  async function getInstitutionData() {
    UNIVERSITIES.length = 0;
    const data = await getInstitutions(`/eligibility/list`);
    if (!data.data || data.error) return data?.error;
    else {
      for (let i = 0; i < data.data.length; i++) {
        UNIVERSITIES.push(data.data[i]);
      }
      return UNIVERSITIES;
    }
  }

async function getAccommodationsData(_visibleCount) {
try {
  const page_idx  = parseInt(_visibleCount/15);

  const accommodation_data = await getAccommodations(`/accommodation/list?page=${page_idx}`);
  if(accommodation_data.error)if (accommodation_data.error.length >0) return accommodation_data.error;

  const _accAll=[];


   let urls =[];
   if(accommodation_data.urls) urls =accommodation_data.urls;
  if(accommodation_data.data){
   for(let i = 0; i < accommodation_data.data.length;i++){
    const accommodation = accommodation_data.data[i];
   const id = accommodation.id;
    const _name = accommodation.name;
     
    const university_name = accommodation.university_name;
    const price = accommodation.price;
    const location =accommodation.location;
    const type = accommodation.type;
    const accredited = accommodation.accredited;
    const description = accommodation.description;
    const link = accommodation.link;
    const opens = accommodation.opens;
    const closes = accommodation.closes;
    var accreditation ='';   
    if(accredited)accreditation='nsfas' ;
    else accreditation ='private'  
   let cover_image =[];
   if(urls.length>0)if(urls[i].links)cover_image =urls[i].links[0];

   let images =[];
   if(urls.length>0)if(urls[i].links)images =urls[i].links;
      
   
    _accAll.push(
    [
      `id: ${id||0},
      name: ${_name||''},
      university_name: ${university_name||''},
      address: ${location||''},
      price_min: ${Number(price.min)||0},
      price_max: ${Number(price.max)||0},
      room_types: ${[type.first, type.second]},
      closing_date: ${closes||''},
      opening_date: ${opens||''},
      description: ${description||''},
      apply_url: '#',
      accreditation: ${accreditation||null} ,
      cover_image: ${cover_image||''},
      images: ${images||[]},
      features: ${[]}`
    ]
    );

  };
   }

   return _accAll;
  
} catch (error) {
//  
return `failed to fetch accommodation data ${error}`;
}

  }


  async function getQualificationData(identifier) {
    QUALIFICATIONS.length = 0;
    const data = await getQualifications(`/eligibility/qualifications?identifier=${encodeURIComponent(identifier)}`);
    if (!data.data || data.error) return data?.error;
    else {
      for (let i = 0; i < data.data.length; i++) {
        QUALIFICATIONS.push(data.data[i]);
      }
      return QUALIFICATIONS;
    }
  }

  async function getSubjectData() {
    SUBJECTS.length = 0;
    const data = await getSubjects(`/eligibility/subjects`);
    if (!data.data || data.error) return data?.error;
    else {
      for (let i = 0; i < data.data.length; i++) {
        SUBJECTS.push(data.data[i]);
      }
      return SUBJECTS;
    }
  }

  async function calculateAps(endpoint, data) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front_data: data })
      });
      const data_ = await response.json();
      return data_;
    } catch (error) {
      return {error:'failed to fetch calculated APS data',data:[]};
    }
  }
  async function getCalculatedApsData(_data) {
    const other_qualifications =[];

    const data = await calculateAps(`/eligibility/`,_data);
    if (!data.data || data.error) return data?.error;
    else {
    if(Object.keys(data?.alt).length>0){
      for(const item of data.alt)other_qualifications.push(item);
    }
      return ` APS  :${data.data.aps} average APS :${data.data.average} , eligibility :${data.data.eligibility} ,requirements :${data.data.requirements} ,reasons :${data.data.reasons}`;
    }
  }

async function getUserRole(email:string) {
 const spbase_client =supabase_client();
 const role = await getChatRole(spbase_client,email);
 if(role?.error)if(role.error.length>0)return role.error;
 return role?.data  ;
}

async function getChatbotFqa() {
 const spbase_client =supabase_client();
 const data =await getChatFqa(spbase_client);
 const response = data?.data ;

 if(data?.error)if(data?.error.length>0 )return data?.error; 
  
 if(response)return `Categories:account management : ${response.account_management }
billing and payments :${response.billing_payments}
university applications :${response.university_applications}
college applications:${response.college_applications}
bursaries :${response.bursaries}
document upload :${response.document_upload}
application management :${response.application_management}
accommodation :${response.accommodation}
technical issues :${response.technical_issues}
general support: ${response.general_support} `  ;


}

async function getSourceData(institution_id:string) {
 const spbase_client =supabase_client();
 const data = await getSources(spbase_client,institution_id);
 if(data?.error)if(data.error.length>0)return data.error;
 return data?.data  ;
}

async function logBehaviour(abuse_flag:string,abuse_count:number,abuse_description:string,email:string) {
 const spbase_client =supabase_client();
 const des = []
 for(const item of current_chat_history){
  des.push(item);
 }
 des.push(abuse_description);
 const _log = {abuse_flag:abuse_flag,abuse_count:abuse_count,abuse_description:des}
 
 const data = await addUser_ChatLog(spbase_client,_log,email);
 if(data?.error)if(data.error.length>0)return data.error;
  return "user behaviour logged"  ;

}



// ticket
async function createTicket(username:string,email:string,subject:string,description:string,priority=null){
 const spbase_client = supabase_client();
  
const solved_at_d = new Date().toISOString();
const due_at_d = new Date();
due_at_d.setUTCHours(23,59,0,0);
const due_at_utc = due_at_d.toISOString(); 
const ticket_uuid_id = nanoid20();

 const namesarray = username.split(' ')
 const ticket_date = new Date().toISOString();
 const ticket_id = `${(namesarray[0])[0]}${ticket_uuid_id}${(namesarray[1])[0]}${ticket_date} `; 

let data_;
const ticket_data = {ticket_id:ticket_id,username:username,email:email,chat_index:chat_index,subject:subject,description:description,status:"open",due_at:due_at_utc }
if(priority)data_ = {...ticket_data,priority:priority};
else data_ = ticket_data;
const data = await addChat_ticket(spbase_client ,data_);

 if(data?.error)if(data?.error.length>0 )return data?.error;
 return `sucssesfully added ticket , ticket id: ${data_.ticket_id}, human_agent : ${human_agent} , status ${data_.status} `; 

}

async function updateTicket(ticket_data){
 const spbase_client = supabase_client();
  
//const solved_at_d = new Date().toISOString;



//const ticket_data = {email:email,chat_index:chat_index,human_agent:human_agent,subject:subject,description:description,status:status,priority:priority,solved_at:solved_at_d }

const data = await setChat_ticket(spbase_client ,ticket_data);

 if(data?.error)if(data?.error.length>0 )return data?.error;
 return `sucssesfully updated ticket , ticket id: ${ticket_data.ticket_id}, human_agent : ${human_agent} , status ${ticket_data.status} `; 
 //return "tool call failed";
}


async function setTicketStatus(ticket_id:string,email:string,status:string,priority=null){
  let data;

  const solved_at_d = new Date().toISOString();
  const due_at_d = new Date();
  due_at_d.setUTCHours(23,59,0,0);
  const due_at_utc = due_at_d.toISOString(); 


  const ticket_data = {ticket_id:ticket_id,email:email,status:status}

  if(priority) data = {...ticket_data,priority:priority};
  else data = ticket_data;

  if(status ==='solved') data = {...ticket_data,solved_at:solved_at_d};
  else if (status ==='reopened')data={...ticket_data,solved_at:null,due_at:due_at_utc }
  else data = ticket_data;

  return await updateTicket(data)
  }


async function humanSupport(ticket_id:string,email:string,priority=null){
  human_agent = true;
  let data;
  const ticket_data = {email:email,human_agent:human_agent,status:"on-hold" }
  if(priority) data = {...ticket_data,priority:priority};
  else data = ticket_data;

  return await updateTicket(data)
  }

async function getTickets(ticket_id:string,email:string) {
 const spbase_client =supabase_client();
 const ticket_data = {ticket_id:ticket_id,email:email,status:"open"}

 const data = await getChat_tickets(spbase_client,ticket_data);
 if(data?.error)if(data.error.length>0)return data.error;
 return data?.data  ;
}

async function chat(client, spbase_client,settings,chat,history,tools,username,email){
  try {
    let response = "";

    let model_config ;
if(settings.manual_models.includes(String(settings.model))) model_config = 
    {
      model: String(settings.model),
      max_tokens: Number(settings.chat_tokens),
      cache_control:settings.cache_control,
      thinking:settings.manual_thinking,
      system:String(settings.system_prompt),
      tools,
      // Ask for at most one tool call per turn.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages:chat
    };else model_config = 
    {
      model: String(settings.model),
      max_tokens: Number(settings.chat_tokens),
      cache_control:settings.cache_control,
      thinking:settings.thinking,
      output_config:settings.output_config,
      system:String(settings.system_prompt),
      tools,
      // Ask for at most one tool call per turn.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages:chat
    };

    const message = await client.messages.create(model_config);


 
    // tool loop:
    let toolUse = null;
    toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    )!;
     if(toolUse && toolUse !==null ){
      console.log(`Claude called ${toolUse.name} with ${JSON.stringify(toolUse.input)}`);
      let tool_results ="";
      /* for getting data*/
      /*
      if(toolUse.name ==="getInstitutionData")tool_results= JSON.stringify(await getInstitutionData());
      else if(toolUse.name ==="getQualificationData")tool_results =JSON.stringify( await getQualificationData(toolUse.input.identifier));
      else if(toolUse.name ==="getSubjectData")tool_results = JSON.stringify(await getSubjectData());
      else if(toolUse.name === "getCalculatedApsData")tool_results = JSON.stringify(await getCalculatedApsData(toolUse.input._data));
      else if(toolUse.name === "getAccommodationsData")tool_results = JSON.stringify(await getAccommodationsData(toolUse.input._visibleCount)); 
      else if(toolUse.name === "getChatbotFqa")tool_results = JSON.stringify(await getChatbotFqa()); 
      else if(toolUse.name === "getUserRole")tool_results = JSON.stringify(await getUserRole(toolUse.input.email));
      else if(toolUse.name === "getSourceData")tool_results = JSON.stringify(await getSourceData(toolUse.input.institution_id));
      
      else*/ if(toolUse.name === "createTicket")tool_results = JSON.stringify(await createTicket(toolUse.input.username,toolUse.input.email,toolUse.input.subject,toolUse.input.description,toolUse.input?.priority));       
      else if(toolUse.name === "humanSupport")tool_results = JSON.stringify(await humanSupport(toolUse.input.ticket_id,toolUse.input.email,toolUse.input?.priority));       
      else if(toolUse.name === "setTicketStatus")tool_results = JSON.stringify(await setTicketStatus(toolUse.input.ticket_id,toolUse.input.email,toolUse.input.status,toolUse.input?.priority));       
      else if(toolUse.name === "getTickets")tool_results = JSON.stringify(await getTickets(toolUse.input.ticket_id,toolUse.input.email));       
      else if(toolUse.name === "logBehaviour")tool_results = JSON.stringify(await logBehaviour(toolUse.input.abuse_flag,toolUse.input.abuse_count,toolUse.input.abuse_description,toolUse.input.email));




      chat.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, content: tool_results }]
        }
      );  

     let toll_call_count = 0
     while (toolUse !==null && toll_call_count <2){     
      // Run the tool, then send the result back in a tool_result block.
  

      // follow up chat
      const {tools,tool_choice ,...without_tools}= model_config;
      const followup = await client.messages.create(without_tools);

      toolUse = followup.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      )!;
     /* multi tool call failed , next implementation use in build feature.      
     if(toolUse && toolUse !==null ){      
      if(toolUse.name ==="getInstitutionData")tool_results= JSON.stringify(await getInstitutionData());
      else if(toolUse.name ==="getQualificationData")tool_results =JSON.stringify( await getQualificationData(toolUse.input.identifier));
      else if(toolUse.name ==="getSubjectData")tool_results = JSON.stringify(await getSubjectData());
      else if(toolUse.name === "getCalculatedApsData")tool_results = JSON.stringify(await getCalculatedApsData(toolUse.input._data));
      else if(toolUse.name === "getUserRole")tool_results = JSON.stringify(await getUserRole(toolUse.input.email));
      else if(toolUse.name === "getAccommodationsData")tool_results = JSON.stringify(await getAccommodationsData(toolUse.input._visibleCount)); 
      else if(toolUse.name === "getChatbotFqa")tool_results = JSON.stringify(await getChatbotFqa()); 
      else if(toolUse.name === "createTicket")tool_results = JSON.stringify(await createTicket(toolUse.input.username,toolUse.input.email,toolUse.input.subject,toolUse.input.description,toolUse.input?.priority));       
      else if(toolUse.name === "humanSupport")tool_results = JSON.stringify(await humanSupport(toolUse.input.ticket_id,toolUse.input.email,toolUse.input?.priority));       
      else if(toolUse.name === "setTicketStatus")tool_results = JSON.stringify(await setTicketStatus(toolUse.input.ticket_id,toolUse.input.email,toolUse.input.status,toolUse.input?.priority));       
      else if(toolUse.name === "getTickets")tool_results = JSON.stringify(await getTickets(toolUse.input.ticket_id,toolUse.input.email));       
      else if(toolUse.name === "getSourceData")tool_results = JSON.stringify(await getSourceData(toolUse.input.institution_id));
      else if(toolUse.name === "logBehaviour")tool_results = JSON.stringify(await logBehaviour(toolUse.input.abuse_flag,toolUse.input.abuse_count,toolUse.input.abuse_description,toolUse.input.email));




      chat.push(
        { role: "assistant", content: followup.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, content: tool_results }]
        }
      );

      }

      */      
      // Claude uses the result to answer the original question.
      const finalText = followup.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )!;
      if(finalText?.text)response = finalText.text;
      chat.push({ role: "assistant", content:followup.content });
       const {id ,...followup_without_id} = followup;
       const new_followup = {...followup_without_id,chat_id:id}
       const chat_log = await addChat_log(spbase_client,{model:new_followup.model,type:new_followup.type,role:new_followup.role,content:new_followup.content,container:new_followup.container,stop_reason:new_followup.stop_reason,stop_sequence:new_followup.stop_sequence,stop_details:new_followup.stop_details,usage:new_followup.usage,chat_id:new_followup.chat_id,username:username,email:email})

      if(chat_log?.error)if(chat_log?.error.length>0)return {error:chat_log?.error,data:chat_log.data,code:chat_log?.code};
      toolUse = null;
      toll_call_count++;
    }//end of loop

    }
      else {

      const finalText = message.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )!;
      if(finalText?.text)response = finalText.text;
      chat.push({ role: "assistant", content:message.content });

      const {id ,...message_without_id} = message;
      const new_message = {...message_without_id,chat_id:id}
      const chat_log = await addChat_log(spbase_client,{model:new_message.model,type:new_message.type,role:new_message.role,content:new_message.content,container:new_message.container,stop_reason:new_message.stop_reason,stop_sequence:new_message.stop_sequence,stop_details:new_message.stop_details,usage:new_message.usage,chat_id:new_message.chat_id,username:username,email:email})
      if(chat_log?.error)if(chat_log?.error.length>0)return {error:chat_log?.error,data:chat_log.data,code:chat_log?.code};
    
      }

   if(history.length>0)history[history.findLastIndex] = chat;
   else {
    if(history[0]=== null)history[0]=chat;
    else history.push(chat);
    }
  const chat_add =  await  addChat(spbase_client,history,email);
  if(chat_add?.error)if(chat_add?.error.length>0)return {error:chat_add?.error,data:chat_add.data,code:chat_add?.code};


   return {error:"",data:response,code:200};

  } catch (error) {
    const chat_log = await addChat_log(spbase_client,{error:{error:error},username:username,email:email})
    if(chat_log?.error)if(chat_log?.error.length>0)return {error:chat_log?.error,data:chat_log.data,code:chat_log?.code};

    return  {error: `error communicating with Zuzu error: ${error}`,data:"",code:300} ;
  }  
}















Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return _json("ok");//new Response("ok", { headers: CORS });
  try {

    const origin = req.headers.get("origin");
  if (origin && origin !== "http://127.0.0.1:5500" ) {
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
  

const tools: Anthropic.Tool[] = [
  /* for getting querycrest related data
  {
    name: "getInstitutionData",
    description: "Get list of Institutions",
    input_schema: {
      type: "object",
 
      required: [""]
    }
  },
  {
    name: "getQualificationData",
    description: "Get list of Qualification",
    input_schema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: " id from the list of Institutions " }
      },
      required: ["identifier"]
    }
  },
  {
    name: "getSubjectData",
    description: "Get list of Subjects",
    input_schema: {
      type: "object",
      required: [""]
    }
  },
  {
    name: "getCalculatedApsData",
    description: "Get detailed calculated APS",
    input_schema: {
      type: "object",
      properties: {
        _data: { type: "object", description: "institutionId:string ,qualifictionId:string ,subjects:array of object{subject,mark}" }
      },
      required: ["_data"]
    }
  },
  {
    name: "getUserRole",
    description: "Get a role of a user",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "email of the user" }
      },
      required: ["email"]
    }
  },
  {
    name: "getAccommodationsData",
    description: "Get list of accommodations",
    input_schema: {
      type: "object",
      properties: {
        _visibleCount: { type: "number", description: "pagination in increament of 15 the page return 15 accommodation per page , first page is  15 then second page is  30 " }
      },
      required: ["_visibleCount"]
    }
  },
  {
    name: "getChatbotFqa",
    description: "Get list of FQA, Frequently Questioned Answers  A collection of answers to commonly asked questions.",
    input_schema: {
      type: "object",

      required: [""]
    }
  },
{
    name: "getSourceData",
    description: "Get list of Sources",
    input_schema: {
      type: "object",
      properties: {
        institution_id: { type: "string", description: "institution id for source of information you are looking for" }
      },
      required: ["institution_id"]
    }
  },*/
  {
    name: "humanSupport",
    description: "Elevate to level 2 and get user connect user with human agent",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "id for the ticket" },
        email: { type: "string", description: "email of the user" },
        priority: { type: "string", description: "priority for the ticket , critical, high, normal , low" }                
      },
      required: ["ticket_id","email"]
    }
  },{
    name: "setTicketStatus",
    description: "Update a ticket",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "id for the ticket" },
        email: { type: "string", description: "email of the user" },
        status:{type: "string", description: "status for the ticket , default: new , new:just created , open:set when called the createTicket , pending:set this after your response after creating ticket , on-hold: waiting on internal system, solved: resolved waiting for confirmation from the user ,closed: final ,reopened : user replies fater closed" },
        priority: { type: "string", description: "priority for the ticket , default: low , critical, high, normal , low" }                
      },
      required: ["ticket_id","email","status"]
    }
  },{
    name: "createTicket",
    description: "Create a ticket",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "username is made up of user first name surname space between the names" },
        email: { type: "string", description: "email of the user" },
        subject: { type: "string", description: "subject is the title of problem discussed" },
        description: { type: "string", description: "description of the issue the user is facing" },                
        priority: { type: "string", description: "priority for the ticket , default: low , critical, high, normal , low" }                
      },
      required: ["username","email","subject","description",]
    }
  },
{
    name: "getTickets",
    description: "Get list of tickets",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "id for the ticket" },
        email: { type: "string", description: "email of the user" },

      },
      required: ["ticket_id","email"]
    }
  },
{
    name: "logBehaviour",
    description: "log user behaviour",
    input_schema: {
      type: "object",
      properties: {
        abuse_flag: { type: "boolean", description: "flag the user for misuse of the querycrest services" },
        abuse_count: { type: "number", description: "number of misuse , starting from 0 which means they havent done any thing to 3 which is the max ,0,1,2,3" },        
        abuse_description: { type: "string", description: "description of the misuse in detail " }, 
        email: { type: "string", description: "email of the user" }               
      },
      required: ["abuse_flag","abuse_count","abuse_description","email"]
    }
  }






];
    


    const spbase_client = supabase_client();
    const fields_limits = 100     


    
    // ============================================================
    // Method - Actions
    // ============================================================
    // 

    // ============================================================
    // GET - Chat  add new chat
    // ============================================================
    if (method === "PUT" && path.includes("new") ){
       //
      const body = await req.text();
      //Reject any body larger than 8 KB to prevent payload attacks. 
      if(body.length > MAX_BODY_SIZE){
          return _json({error:`Request body is too large. Max size is ${MAX_BODY_SIZE/1024} KB`},400);
      }
      //Read and parse the JSON request body. 
      const {firstName:name,surname:Surname,email:Email,prompt:Prompt} = JSON.parse(body);
      const firstName = name.toLowerCase();
      const surname = Surname.toLowerCase();
      const email = Email.toLowerCase();
      const prompt = Prompt.toLowerCase();

      const request_time = new Date();
      //vaildate
      const regex = /^[A-Za-z]+$/;

      if (!firstName.trim()  ) {
        return _json({ error: "first name field required" ,data:[]}, 400);
      }
      if (!surname.trim()  ) {
        return _json({ error: "surname field required" ,data:[]}, 400);
      }
        if (firstName.length >fields_limits  ) {
        return _json({ error: `first name field has many values limit:${fields_limits}` ,data:[]}, 400);
      }
      if (surname.length > fields_limits  ) {
        return _json({ error: `surname field has many values limit:${fields_limits}`  ,data:[]}, 400);
      }
      if (email.length >fields_limits) {
        return _json({ error:   `email field has many values limit:${fields_limits}` ,data:[]}, 400);
      }
      if (prompt.length>1000 ) {
        return _json({ error: "prompt field has many values limit:1000" ,data:[]}, 400);
      }
      if ( !(regex.test(firstName.trim()) ) ) {
        return _json({ error: "first name field requires only letters" ,data:[]}, 400);
      }
      if ( !(regex.test(surname.trim()) ) ) {
        return _json({ error: "surname field requires only letters" ,data:[]}, 400);
      }
      
      if (!email.trim() && typeof first_name ==="string") {
        return _json({ error: "email field required" ,data:[]}, 400);
      }
      if(!validator.isEmail(email))return _json({ error: "email pattern invaild" ,data:[]}, 400);    
      if (!prompt.trim() && typeof prompt ==="string") {
        return _json({ error: "prompt field required" ,data:[]}, 400);
      }      

       const username = `${firstName}  ${surname}`;      
      const settings = await getSettings(spbase_client);
      if(settings?.error)if(settings.error.length>0)return _json({error:settings?.error,data:settings?.data},settings?.code);      

      const chat_history = await getChatHistory(spbase_client,firstName,surname,email);
      const chat_history_time = await getChatTimeHistory(spbase_client,email);

      if(chat_history?.error)if(chat_history.error.length>0)return _json({error:chat_history?.error,data:"chat_history?.data"},chat_history?.code); 
      if(typeof chat_history?.data ==="object")if(chat_history?.data.abuse_flag)if(chat_history?.data.abuse_count>chat_history?.data.abuse_max_count)      return _json({error:"",data:"you have been banned from the support service, for further assistant contact querycrest support ",human_agent:true},200);
      if(Array.isArray(chat_history?.data?.abuse_description))current_chat_history = chat_history?.data.abuse_description; 
      else current_chat_history =[]
 
      let messages: Anthropic.MessageParam[] =  [
        { role: "user", content: `prompt:${prompt} ,user abuse stats: ,flagged for abuse:${chat_history?.data.abuse_flag} count:${chat_history?.data.abuse_count} , date: ${new Date().toISOString()} ` }
      ]; 

      //add new chat
      const new_chat = [];
      if(chat_history)if(chat_history.data){
       for(const item of chat_history.data?.chat ){
        new_chat.push(item);
       }
      }
      new_chat.push(messages)
      const chat_add =  await  addChat(spbase_client,new_chat,email);
      if(chat_add?.error)if(chat_add?.error.length>0)return _json({error:chat_add?.error,data:"new_chat"},chat_add?.code);


      let history = [];
      
      if(new_chat)if(chat_history  !== null){if(new_chat.length >0){
       const cur_prompt = messages[0];
        if(new_chat.length >1)messages =   new_chat[new_chat.length-1 ] ;
        else messages =   new_chat[0] ;
        if(messages[0] !== cur_prompt)messages.push(cur_prompt);

        history= new_chat;
      }else history = [];
    }

      const response = await chat(chatbot_client,spbase_client,settings?.data,messages,history  ,tools,username,email);
      /*
      const response_time = new Date();
      const duration_time = response_time.getTime() - request_time.getTime();
      const timeHistory = [];
      let time_idx=0;
      if(chat_history_time.data){
      if(chat_history_time.data.length>1)time_idx = chat_history_time.data.length-1;

      for(const item of chat_history_time.data[time_idx]){
        timeHistory.push(item)
      }
      timeHistory.push({
        request_time:request_time,
        response_time:request_time,
        duration_time:duration_time
      });
      chat_history_time.data[time_idx]=timeHistory;
      const time_log = await addChat_timeStamp(spbase_client,chat_history_time.data,email);
      if(time_log?.error)if(time_log?.error.length>0)return _json({error:time_log?.error,data:time_log.data},time_log?.code);                  
      }else{
     timeHistory.push({
        request_time:request_time.toISOString(),
        response_time:request_time.toISOString(),
        duration_time:duration_time
      });

      const time_log = await addChat_timeStamp(spbase_client,timeHistory,email);
      if(time_log?.error)if(time_log?.error.length>0)return _json({error:time_log?.error,data:time_log.data},time_log?.code);                  
         
      }
      */
      return _json({error:response.error,data:response.data,human_agent:human_agent},response.code);
     }

      //}
    // ============================================================
    // GET - Chat History
    // ============================================================
    else if (method === "GET" && path.includes("chat") ){
      const first_name = url.searchParams.get("firstName")?.toLowerCase() || "";
      const surname = url.searchParams.get("surname")?.toLowerCase() || "";      
      const email = url.searchParams.get("email")?.toLowerCase() || "";
      //vaildate
      const regex = /^[A-Za-z]+$/;

      if (!first_name.trim() && typeof first_name ==="string" ) {
        return _json({ error: "first name field required" ,data:[]}, 400);
      }
      if (!surname.trim() && typeof surname ==="string" ) {
        return _json({ error: "surname field required" ,data:[]}, 400);
      }

      if (first_name.length >fields_limits  ) {
        return _json({ error: `first name field has many values limit:${fields_limits}` ,data:[]}, 400);
      }
      if (surname.length > fields_limits  ) {
        return _json({ error: `surname field has many values limit:${fields_limits}`  ,data:[]}, 400);
      }
      if (email.length >fields_limits) {
        return _json({ error:   `email field has many values limit:${fields_limits}` ,data:[]}, 400);
      }

      if ( !(regex.test(first_name.trim()) ) ) {
        return _json({ error: `first name field requires only letters ` ,data:[]}, 400);
      }
      if ( !(regex.test(surname.trim()) ) ) {
        return _json({ error: "surname field requires only letters" ,data:[]}, 400);
      }      
      if (!email.trim()) {
        return _json({ error: "email field required" ,data:[]}, 400);
      }
      if(!validator.isEmail(email))return _json({ error: "email pattern invaild" ,data:[]}, 400);    
      
      const chat_history = await getChatHistory(spbase_client,first_name,surname,email);
      if(chat_history?.error)if(chat_history.error.length>0){return _json({error:chat_history?.error,data:"chat_history?.data?.chat"},chat_history?.code); }
      if(chat_history?.data)return _json({error:chat_history?.error,data:chat_history?.data?.chat[chat_history?.data?.chat.length-1]},chat_history?.code); 
      
      //return _json({error:"failed to get history data",data:[]},404);
    }
    // ============================================================
    // GET - Ticket
    // ============================================================


    // ============================================================
    // PUT - Chat with Zuzu
    // ============================================================
    
    
    else if (method === "PUT" ){
      const body = await req.text();
      //Reject any body larger than 8 KB to prevent payload attacks. 
      if(body.length > MAX_BODY_SIZE){
          return _json({error:`Request body is too large. Max size is ${MAX_BODY_SIZE/1024} KB`},400);
      }
      //Read and parse the JSON request body. 
      const {firstName:name,surname:Surname,email:Email,prompt:Prompt} = JSON.parse(body);
      const firstName = name.toLowerCase();
      const surname = Surname.toLowerCase();
      const email = Email.toLowerCase();
      const prompt = Prompt.toLowerCase();

      const request_time = new Date();
      //vaildate
      const regex = /^[A-Za-z]+$/;

      if (!firstName.trim() && typeof firstName ==="string") {
        return _json({ error: "first name field required" ,data:[]}, 400);
      }
      if (!surname.trim() && typeof surname ==="string" ) {
        return _json({ error: "surname field required" ,data:[]}, 400);
      }

      if (firstName.length >fields_limits  ) {
        return _json({ error: `first name field has many values limit:${fields_limits}` ,data:[]}, 400);
      }
      if (surname.length > fields_limits  ) {
        return _json({ error: `surname field has many values limit:${fields_limits}`  ,data:[]}, 400);
      }
      if (email.length >fields_limits) {
        return _json({ error:   `email field has many values limit:${fields_limits}` ,data:[]}, 400);
      }

      if ( !(regex.test(firstName.trim() ) ) ) {
        return _json({ error: "first name field requires only letters" ,data:[]}, 400);
      }
      if ( !(regex.test(surname.trim() ) ) ) {
        return _json({ error: "surname field requires only letters" ,data:[]}, 400);
      }

      if (!email.trim() && typeof email ==="string") {
        return _json({ error: "email field required" ,data:[]}, 400);
      }
      if (!prompt.trim() && typeof prompt ==="string") {
        return _json({ error: "prompt field required" ,data:[]}, 400);
      }

      if (prompt.length>1000 ) {
        return _json({ error: "prompt field has many values limit:1000" ,data:[]}, 400);
      }

    if(!validator.isEmail(email))return _json({ error: "email pattern invaild" ,data:[]}, 400);     
      const settings = await getSettings(spbase_client);
      if(settings?.error)if(settings.error.length>0)return _json({error:settings?.error,data:settings?.data},settings?.code);      

      const chat_history = await getChatHistory(spbase_client,firstName,surname,email);
      const chat_history_time = await getChatTimeHistory(spbase_client,email);
      
      if(chat_history?.error)if(chat_history.error.length>0)return _json({error:chat_history?.error,data:chat_history?.data},chat_history?.code); 
      if(typeof chat_history?.data ==="object")if(chat_history?.data.abuse_flag)if(chat_history?.data.abuse_count>chat_history?.data.abuse_max_count)      return _json({error:"",data:"you have been banned from the support service, for further assistant contact querycrest support ",human_agent:true},200);
      if(Array.isArray(chat_history?.data?.abuse_description))current_chat_history = chat_history?.data.abuse_description; 
      else current_chat_history =[]
 
      let messages: Anthropic.MessageParam[] =  [
        { role: "user", content: `prompt:${prompt} ,user abuse stats: ,flagged for abuse:${chat_history?.data.abuse_flag} count:${chat_history?.data.abuse_count} date: ${new Date().toISOString()} ` }
      ]; 
      let history = [];
      
      if(chat_history?.data)if(chat_history.data.chat  !== null){if(chat_history.data.chat.length >0){
       const cur_prompt = messages[0];
        if(chat_history.data.chat.length >0)messages =   chat_history.data.chat[(chat_history.data?.chat.length)-1 ] ;
        else messages =   chat_history.data.chat[0] ;
        messages.push(cur_prompt);
        history= chat_history.data.chat;
      }else history = [];
    }
       const username = `${firstName}  ${surname}`;
      if(chat_history?.data)if(chat_history.data?.chat.length>0)chat_index = (chat_history.data?.chat.length)-1;else chat_index=0;

      const response = await chat(chatbot_client,spbase_client,settings?.data,messages,history  ,tools,username,email);
      /*
      const response_time = new Date();
      const duration_time = response_time.getTime() - request_time.getTime();
      const timeHistory = [];
      let time_idx=0;
      if(chat_history_time.data){
      
   
      //add null to missing data
      for(const [time_his_dix,history_item] of chat_history_time.data){

        if(history_item.length ===0 || history_item==null)
      }
      if(chat_history_time.data.length>1)time_idx = chat_history_time.data.length-1;


      for(const item of chat_history_time.data[time_idx]){
        timeHistory.push(item)
      }
      timeHistory.push({
        request_time:request_time.toISOString(),
        response_time:request_time.toISOString(),
        duration_time:duration_time
      });
      chat_history_time.data[time_idx]=timeHistory;
      const time_log = await addChat_timeStamp(spbase_client,chat_history_time.data,email);
      if(time_log?.error)if(time_log?.error.length>0)return _json({error:time_log?.error,data:time_log.data},time_log?.code);                  
      }else{
     timeHistory.push({
        request_time:request_time,
        response_time:request_time,
        duration_time:duration_time
      });

      const time_log = await addChat_timeStamp(spbase_client,timeHistory,email);
      if(time_log?.error)if(time_log?.error.length>0)return _json({error:time_log?.error,data:time_log.data},time_log?.code);                  
         
      }
      */      
      return _json({error:response.error,data:response.data,human_agent:human_agent},response.code);

    }
 
   else {
        return _json({ error: "API call failed",data:[] }, 300);    
   }

  } catch (error){
    return _json({ error: `Server error ${error}`,data:[] }, 300);
  }
});

