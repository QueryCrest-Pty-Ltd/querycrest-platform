
  /*widget js*/
  //DOM refs
  const toggleBtn = document.getElementById('widgetToggleBtn');
  const feedbackCard = document.getElementById('feedbackCard');
  const feedbackWidget = document.getElementById('feedbackWidget');
  const cancelBtn = document.getElementById('cancelFeedbackBtn');
  const sendBtn = document.getElementById('sendFeedbackBtn');
  const toastMsg = document.getElementById('toastMsg');
  const feedbackText = document.getElementById('feedbackText');
  const email = document.getElementById('fbEmail');
  const name = document.getElementById('fbName');

  let isCardOpen = false;
  let isWidgetVisible = true;
  function resetForm(){
    feedbackText.value ='';
    email.value ='';
    name.value = '';

  }

  function closeCard(){
    feedbackCard.classList.remove('open');
    isCardOpen = false;
    resetForm();
  }

  function openCard(){
    feedbackCard.classList.add('open');
    isCardOpen= true;
    resetForm();
    feedbackText.focus();

  }

  function hideWiget(){
    feedbackWidget.classList.add('hide');
    isWidgetVisible = false;

  }

  function showWidget(){
    feedbackWidget.classList.remove('hide');
    isWidgetVisible = true;

  }  

  function showToast(){
  toastMsg.classList.add('show');
  clearTimeout(toastMsg._timer);
  toastMsg._timer = setTimeout(() =>{
    toast.classList.remove('show');
  },2800)
  }

async  function sendFeedback(){
    try {
    if (feedbackText.value.length ===0 ){
      alert("feedback filed required ");
      return
    }
    const response =  await fetch("https://xkjsydeavdcarwkthppz.supabase.co/functions/v1/feedback",{
        method:"POST",
        headers:{
            "Content-Type":"application/json",
        },
        body:JSON.stringify(
            {
                
                feedback_report: feedbackText.value,
                feedback_email:email.value,
                feedback_name:name.value,

            }
        )

    });
    const data = await response.json();
    if(data){
    if(data.error) alert(data.error);
    if(data.success)showToast();
    } 
    } catch (error) {
        alert(error);
    }


  }
  setInterval(()=>{
    if(isWidgetVisible){
      hideWiget();
    }else showWidget();

  },600000)
  // event listeners


  toggleBtn.addEventListener('click',function(e){
    e.stopPropagation();
    if(isCardOpen){
      closeCard();
    }else openCard();
  })

  cancelBtn.addEventListener('click',function(e){
    e.stopPropagation();
    closeCard();
  })

  sendBtn.addEventListener('click',function(e){
    e.stopPropagation();
    sendFeedback();
  })
  