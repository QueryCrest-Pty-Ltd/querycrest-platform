//import validator from "npm:validator";
(async ()=>{
    
    "use strict"
     
    //refs
    const messagesEl = document.getElementById("chatbot-messages");
    const chatbotForm = document.getElementById("chatbotform");
    const chatInput = document.getElementById("chatbot-input");
    const sendBtn = document.getElementById("sendChatbotBtn");
    const chatbotToggleBtn = document.getElementById('chatbotToggleBtn');
    const chatbotWidget = document.getElementById('chatbotWidget');
    const cancelBtn = document.getElementById('cancelCbBtn');
    const newChatBtn = document.getElementById('addCbChatBtn');    
    const API_BASE = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1";
    let profile =null;
    let isWidgetVisible = false;    
    let intro = null;
    let clearChatId = null;

    function hideWiget(){
    chatbotWidget.classList.add('hide');
    isWidgetVisible = false;

  }

  function showWidget(){
    chatbotWidget.classList.remove('hide');
    isWidgetVisible = true;

  } 

  function clearChat(){
    if(isWidgetVisible){
      hideWiget();
    }
   if(messagesEl.children.length ===0)return
    // remove user details
    sessionStorage.removeItem("user-chatbot-details");
    //clear out the chats
   if(messagesEl.children.length !==0) messagesEl.replaceChildren();
   profile = null;
    chatInput.disabled =false;
    sendBtn.disabled =false;
    chatInput.value ="";
    chatInput.placeholder = "Please complete the form above…";
    chatInput.focus(); 
    startChat();
   clearChatId = null;    
  }
  // display or hide the chatbot card
  chatbotToggleBtn.addEventListener('click',function(e){
    e.stopPropagation();
    if(isWidgetVisible){
      hideWiget();
    }else showWidget();
  });
  
  // display or hide the chatbot card
  cancelBtn.addEventListener('click',function(e){
    e.stopPropagation();
    if(isWidgetVisible){
      hideWiget();
    }//else showWidget();
  });



  
  // create new chat and get response without showing the detail form
  newChatBtn.addEventListener('click',async function (e){
    e.stopPropagation();
    if(isWidgetVisible){
  if(  sessionStorage.getItem('user-chatbot-details') ===null) return;
  const data =JSON.parse(sessionStorage.getItem('user-chatbot-details'));

  const history = await addChat("/chatbot/new",{...data,prompt:`you are connected to user : first name: ${data.firstName}  , surname: ${data.surname} , email:${data.email}`});
  if(history.error.length>0)alert(history.error);
  addMessage(buildUserDetailsMessage(data),'user');
  //unlock the chatbot form
  chatInput.disabled =false;
  sendBtn.disabled =false;
  chatInput.placeholder = "Type your message..";
  chatInput.focus();  

  /*    intro = sessionStorage.getItem("details_form");    
  const form = intro[0].querySelector(".intro-form");
  const errorEl = form.querySelector(".error");

    if(history.error.length>0){
      errorEl.textContent =history.error;
      errorEl.style.display ="block";
      return;
    }
    errorEl.style.display ="none"; 
    */
    //add bot response

    await addMessage(history.data,'bot',true);
    
    }
  });

  const escapeHtml = (str)=> String(str).replace(/[&,."'"]/g,(c) =>({"&":"&amp;","<":"&alt;",">":"&gt;",'"':"&quot;","'":"&339;"}[c])) 
  
  function scrollToBottom(){
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  // chat with Zuzu
  async function sendChat(endpoint, data) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:JSON.stringify({ firstName: data.firstName,
          surname:data.surname,
          email:data.email,
          prompt:data.prompt
      })
      });
      const data_ = await response.json();
      return data_;
    } catch (error) {
      return {error:`failed to fetch Zuzu response data ${error}`,data:[]};
    }
  }
  //add new chatbot history
  async function addChat(endpoint,data) {
    try {
      const response = await fetch(`${API_BASE}${endpoint} `, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:JSON.stringify({ firstName: data.firstName,
          surname:data.surname,
          email:data.email,
          prompt:data.prompt
      })
      });
      const data_ = await response.json();
      return data_;
    } catch (error) {
      return {error:`failed to add new chat  ${error}`,data:[]};
    }
  }
  //get chatbot history
  async function getChat(endpoint, data) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data_ = await response.json();
      return data_;
    } catch (error) {
      return {error:`failed to fetch Zuzu response data ${error}`,data:[]};
    }
  }  
  

  /**
   * Append a message bubble.
   * @param{string|Node} content HTML string,plain string or dom node
   * @param {"bot"|"user"} sender
   * @param {boolean} asHTML render string as HTML (bot only)
   */
  function addMessage(content,sender,asHTML=false){
    const wrap = document.createElement("div");
    wrap.className = "message " + sender;

    const avatar = document.createElement("div");
    avatar.className ="avater";
    avatar.innerHTML = sender ==="bot" ? '<i class="ph ph-robot"></i>' :'<i class="ph ph-user"></i>' ; 

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if(content instanceof Node)bubble.appendChild(content);
    else if(asHTML) bubble.innerHTML = content;
    else bubble.textContent = content;
  
  wrap.append(avatar,bubble);
  messagesEl.appendChild(wrap)
  scrollToBottom()
  return wrap;
  
  }

  /* typing indicator*/
  function showTyping(){
    const wrap = document.createElement("div");
    wrap.className ="message bot";
    wrap.innerHTML = '<div class="bot"><i class="ph ph-robot"></i></div>'+
    '<div class "bubble typing"> <span></span><span></span><span></span> </div>';
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  async function botSay(html,details){
    const typing = showTyping();

    if(html !=='<p>Connecting..</p>'){
    const data = {
      firstName:details.firstName,
      surname:details.surname,
      email:details.email,
      prompt:html
    }      
    const response = await sendChat('/chatbot',data);

    let chat ="";
    if(response.error)if(response.error.length>0)chat = response.error;else chat = response.data;
    else chat = response.data 
    const box =addMessage(chat,'bot',true);
    typing.remove();
    if(data.human_agent)window.location.href = "https://wa.me/27692483470?text=Hi%20QueryCrest%20%F0%9F%91%8B";
    return box
  }else{
   const box = addMessage(html,'bot',true);
    typing.remove();
    return box
  }
  }
  /*step 1 ask the user for details */
  function createIntroFormMessage(){
    const box = document.createElement("div");
    box.innerHTML =`
    <p>Hi there! <i class="ph ph-hand-waving"></i> Welcome</p>
    <p>Before we get started, could you please tell me your
      <strong>First name</strong>, <strong>surname</strong> and <strong>email</strong>?</p>

    <form class="intro-form" novalidate>
      <lable>First name
        <input type="text" name="firstName" placeholder="Zuzu" autocomplete="given-name">
        </lable>
      <lable>Surname
        <input type="text" name="surname" placeholder="Assistant" autocomplete="family-name">
        </lable>
      <lable>Email
        <input type="email" name="email" placeholder="zuzu@example.com" autocomplete="email">
        </lable>                
      <P class="error" role="alert"></p>
        <button type="submit">Submit</button>
        </form>

    `;
  return box;
  }

  function buildUserDetailsMessage(data){
   const box = document.createElement("div");
   box.className ="details";
   [["First name",data.firstName],
    ["Surname",data.surname],
    ["Email",data.email] 
  ].forEach(([label,value]) =>{
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = label+": ";
    row.appendChild(strong);
    row.appendChild(document.createTextNode(value));
    box.appendChild(row);

  });
  return box
  }
  async function startChat(){
    intro = createIntroFormMessage();
   //if(sessionStorage.getItem("details_form")===null)sessionStorage.setItem("details_form",intro);

   const wrap = await botSay('<p>Connecting..</p>',{firstName:null,surname:null,email:null});

   const bubble = wrap.querySelector(".bubble");
   bubble.innerHTML ="";
   bubble.appendChild(intro);
   wrap.classList.add("wide");
   scrollToBottom();
   
   const form = intro.querySelector(".intro-form");
   const errorEl = form.querySelector(".error");
  
   form.addEventListener("submit",async(e) =>{
    e.preventDefault();

    const data = {
      firstName:form.firstName.value.trim(),
      surname:form.surname.value.trim(),
      email:form.email.value.trim()            
    };

    //validation
    let problem ="";
    if(!data.firstName) problem = "Please enter your first name,";
    if(!data.surname)problem = "Please enter your surname name,";
    if(!data.email)problem = "Please enter your email address,";
    //if(!validator.isEmail(data.email))problem = "Please enter a valid email address,";  
    if(problem){
      errorEl.textContent =problem;
      errorEl.style.display ="block";
      return;
    }
    errorEl.style.display ="none";

    // lock the form
    profile = data;
    form.querySelectorAll("input").forEach((i)=> (i.disabled=true));
    const submitBtn = form.querySelector("button");
    submitBtn.disabled =true;
    submitBtn.innerHTML ='<i class="ph ph-check"></i> submitted';
    
    // add details as a user
    
    sessionStorage.setItem('user-chatbot-details',JSON.stringify(data))
        // bot reply
    addMessage(buildUserDetailsMessage(data),'user');
    
    //unlock the chatbot form
    chatInput.disabled =false;
    sendBtn.disabled =false;
    chatInput.placeholder = "Type your message..";
    chatInput.focus();

    //bot reply to user details.
    await botSay(`you are connected to user : first name: ${data.firstName}  , surname: ${data.surname} , email:${data.email}`,data)

  } );

  }

async function getChatHistory() {
  if(  sessionStorage.getItem('user-chatbot-details') ===null)return;
  const data =JSON.parse(sessionStorage.getItem('user-chatbot-details'));

  const history = await getChat(`/chatbot/chat?firstName=${encodeURIComponent(data.firstName)}/&surname=${encodeURIComponent(data.surname)}/&email=${encodeURIComponent(data.email)} `,data);
  if(history.error.length>0)alert(history.error);
  addMessage(buildUserDetailsMessage(data),'user');
  //unlock the chatbot form
  chatInput.disabled =false;
  sendBtn.disabled =false;
  chatInput.placeholder = "Type your message..";
  chatInput.focus();  
  /*
  intro = sessionStorage.getItem("details_form");
  alert(intro[0])
  const form = intro[0].querySelector(".intro-form");
  const errorEl = form.querySelector(".error");

    if(history.error.length>0){
      errorEl.textContent =history.error;
      errorEl.style.display ="block";
      return;
    }
    errorEl.style.display ="none";

  */
 let content
  if(history.data){
    for (const chats of history.data){
    for(const chat of chats){

    //add user messages
      if(chat.role==="user"){
      //skip conversation starter
      if(!chat.content.includes(`you are connected to user : first name: ${data.firstName}  , surname: ${data.surname} , email:${data.email}`))
      content = chat.content;
      const start = content.indexOf("user abuse stats:");

      content = content.slice(0,start);
      const end = content.indexOf("prompt:");

      content = content.slice(end+String("prompt:").length);


      addMessage(content,'user',false);
      }
    else if(chat.role==="assistant"){
    //add bot messages,item.content  is array
    //alert(JSON.stringify(item[1].content))
    for (const bot_item of chat.content){
      if(bot_item.type ==="text")addMessage(bot_item.text,'bot',true);

    }      

    }      

    }


    }

  }

}

  //step 2 chatting
  chatbotForm.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const text = chatInput.value.trim();
    if(!text)return;

    addMessage(text,"user");
    chatInput.value ="";
    chatInput.focus();

    // bot reply
    //alert(JSON.parse(sessionStorage.getItem('user-chatbot-details')))
    await botSay(text,JSON.parse(sessionStorage.getItem('user-chatbot-details')));
  //reset timer on use
  if(clearChatId)clearTimeout(clearChatId);
  //30 mins
  if(clearChatId === null)clearChatId = setTimeout(()=>{clearChat()},1800000)

  });
  //set the clearchat timer
  if(clearChatId === null)clearChatId = setTimeout(()=>{clearChat()},1800000)

  //start chat  if we haven't stored user data/first time using the chat 
  //alert(JSON.parse(sessionStorage.getItem('user-chatbot-details')))
  if(  sessionStorage.getItem('user-chatbot-details') !==null){
    if(Object.keys(JSON.parse(sessionStorage.getItem('user-chatbot-details'))).length ===0 ) await startChat();
   //else get chat history
  else  await getChatHistory();      
  }else   await startChat();

  })();