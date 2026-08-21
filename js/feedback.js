
  /*widget js*/
  //DOM refs
  const toggleBtn = document.getElementById('widgetToggleBtn');
  const feedbackCard = document.getElementById('feedbackCard');
  const feedbackWidget = document.getElementById('feedbackWidget');
  const wiget_popUp = document.getElementById('widgetPopUp');
  
  const wiget_toggle = document.getElementById('widgetToggleBtn');

  const cancelBtn = document.getElementById('cancelFeedbackBtn');
  const sendBtn = document.getElementById('sendFeedbackBtn');
  const toastMsg = document.getElementById('toastMsg');
  const feedbackText = document.getElementById('feedbackText');
  const email = document.getElementById('fbEmail');
  const fname = document.getElementById('fbName');

  let isCardOpen = false;
  let isWidgetVisible = false;
  let isSetMsg = false
  function resetForm(){
    feedbackText.value ='';
    email.value ='';
    fname.value = '';

  }

  function closeCard(){
    feedbackCard.classList.remove('open');
    isCardOpen = false;
    resetForm();
  }

  function closeCard(){
    feedbackCard.classList.remove('open');
    document.getElementById('widget-toggle-icon').classList.add('ph-chat-teardrop');
    document.getElementById('widget-toggle-icon').classList.remove('ph-x');    
    isCardOpen = false;
    resetForm();
  }

  function openCard(){
   if(isWidgetVisible){
      hideWiget();
    }
    feedbackCard.classList.add('open');
    document.getElementById('widget-toggle-icon').classList.remove('ph-chat-teardrop');
    document.getElementById('widget-toggle-icon').classList.add('ph-x');
    isCardOpen= true;
    resetForm();
    feedbackText.focus();

  }

  function hideWiget(){
    wiget_popUp.classList.add('hide');
    isWidgetVisible = false;

  }

  function showWidget(){
   if(!isCardOpen){
    wiget_popUp.classList.remove('hide');
    isWidgetVisible = true;
   }
  }  

  function showToast(){
  toastMsg.classList.add('show');
  clearTimeout(toastMsg._timer);
  toastMsg._timer = setTimeout(() =>{
    toast.classList.remove('show');
  },2800)
  }

function getToken(){ return sessionStorage.getItem('access_token') || ''; }
async  function sendFeedback(){
    try {
    if (feedbackText.value.length ===0 ){
    
      setMsg('loginMsg', 'feedback filed required', 'err');
      return
    }
    const response =  await fetch("https://xkjsydeavdcarwkthppz.supabase.co/functions/v1/feedback",{
        method:"POST",
        headers:{
            "Content-Type":"application/json",
            "Authorization":getToken()
        },
        body:JSON.stringify(
            {
                
                feedback_report: feedbackText.value,
                feedback_email:email.value,
                feedback_name:fname.value,

            }
        )

    });
    const data = await response.json();
    if(data){
    if(data.error){

     setMsg('loginMsg', `failed to add report data ${data.error}`,  `${data.error}`);
    } 
    if(data.success)showToast();
    if(data.error ==="Unauthorized"){

      setMsg('loginMsg', 'Unauthorized access please log in first', 'err');
    }
    } 
    } catch (error) {
     setMsg('loginMsg', `failed to add report data ${error}`,  `${error}`);
    }


  }
  setInterval(()=>{
    if(isWidgetVisible){
      hideWiget();
    }else showWidget();

  },600000);

    setInterval(()=>{
    if(isSetMsg){
    document.getElementById('loginMsg').classList.add('hide');     
    }else     document.getElementById('loginMsg').classList.remove('hide');

  },2800);
  // event listeners


  toggleBtn.addEventListener('click',function(e){
    e.stopPropagation();
    if(isCardOpen){
      closeCard();
    }else openCard();
  });

  cancelBtn.addEventListener('click',function(e){
    e.stopPropagation();
    closeCard();
  });

  sendBtn.addEventListener('click',function(e){
    e.stopPropagation();
    sendFeedback();
  });
  
  /* ── Message helper ── */
function setMsg(id, text, type) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (type ? ' ' + type : '');
  el.style.display = text ? 'block' : 'none';
  isSetMsg =true;
  document.getElementById('loginMsg').classList.remove('hide');
}
  