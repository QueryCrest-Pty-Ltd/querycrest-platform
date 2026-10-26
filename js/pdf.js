/*import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

// load a pdf
const existingPdfBytes = fs.readFileSync();
const pdfDoc = await PDFDocument.load(existingPdfBytes);

// get the form and fill the fields
const form = pdfDoc.getForm();

//set texts for the field 



// make it non editable
form.flatten();

const pdfBytes = await pdfDoc.save();
fs.writeFileSync(,pdfBytes);

*/

// pdf.js  <-- a CommonJS module
const { PDFDocument, StandardFonts,rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function main() {
const months = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const generatedDate = new Date();
const student = {firstName:"null",
                 surnameAndInitials:null,
                 email:null
};
const applicationReference = "ddd";
const application = {studentNumber:null   ,  
                     institutionName:"1234567890",
                     placementPeriod:null,
                     portalPassword:null,
                     itsPin:null,
                     shortName:null,
                     programmes:[]
};


const varistyCollegeTemplate =
 {templateId:"student-details-varsity-college",fields:{
//generatedDate:{page:0,x:72,y:990,size:9,offset:3,width:250,height:14},
//applicationReference:{page:0,x:72,y:674,size:9,offset:3,width:250,height:14},
firstName:{page:0,x:85,y:603,size:9,offset:3,width:310,height:14},
surnameAndInitials:{page:0,x:190,y:555,size:9,offset:3,width:300,height:14},
studentNumber:{page:0,x:190,y:540,size:9,offset:3,width:300,height:14},
email:{page:0,x:190,y:525,size:9,offset:3,width:300,height:14},
institutionName:{page:0,x:190,y:510,size:9,offset:3,width:300,height:14},
placementPeriod:{page:0,x:190,y:495,size:9,offset:3,width:300,height:14},
portalPassword:{page:0,x:190,y:480,size:9,offset:3,width:300,height:14},
itsPin:{page:0,x:190,y:465,size:9,offset:3,width:300,height:14},
bursaryName:{page:0,x:190,y:365,size:9,offset:3,width:300,height:14},
programmes_1:{page:0,x:190,y:265,size:9,offset:3,width:300,height:14},
programmes_2:{page:0,x:190,y:255,size:9,offset:3,width:300,height:14}

 }};

const bursaryTemplate = {templateId:"student-details-bursary",fields:{
firstName:{page:0,x:85,y:635,size:9,offset:3,width:280,height:14},
surnameAndInitials:{page:0,x:199,y:590,size:9,offset:3,width:310,height:14},
studentNumber:{page:0,x:199,y:575,size:9,offset:3,width:310,height:14},
email:{page:0,x:199,y:560,size:9,width:310,offset:3,height:14},
institutionName:{page:0,x:199,y:545,size:9,offset:3,width:310,height:14},
placementPeriod:{page:0,x:199,y:529,size:9,offset:3,width:310,height:14},
portalPassword:{page:0,x:199,y:514,size:9,offset:3,width:310,height:14},
//itsPin:{page:0,x:199,y:435,size:9,width:310,height:14}
 }};

const file = "pdf_files/Student-Details-Varsity-College.pdf";
const pdfBytes = fs.readFileSync(file);
const pdfDoc = await PDFDocument.load(pdfBytes);


async function replaceArea({page,x,y,width,height,text,size=9,offset=3,bold=false,line=false,thickness=0.75,xSL,ySL,xEL,yEL}){
    const _page = pdfDoc.getPages()[page];
    let font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    if(bold)font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    //cover the old template values/placeholders.
    _page.drawRectangle({x,y,width,height,color:rgb(0.72, 0.255, 1),borderWidth:0});

    //draw new values
    _page.drawText(String(text ??''),{x,y:y+offset,size,font,color:rgb(0,0,0),maxWidth:width});
    if(line)_page.drawLine({start:{x:xSL,y:ySL},end:{x:xEL,y:yEL},thickness:thickness,color:rgb(0,0,0)});
}

//replace values
if (file.toLowerCase().includes("varsity")){
//add ones outside the JSON Object
//date
replaceArea({page:0,x:63,y:666,size:9,offset:3,width:350,height:15,text:`${generatedDate.getDay() } ${months[generatedDate.getMonth()] } ${generatedDate.getFullYear() }`});
//ref
replaceArea({page:0,x:84,y:650,size:9,offset:3,width:350,height:15,text:applicationReference});
//re
replaceArea({page:0,x:80,y:575,size:10,offset:0,width:230,height:15,text:`${application.institutionName} Application Details`,bold:true,line:true,thickness:1.85,xSL:86,ySL:585,xEL:400,yEL:575});

//univerity name
if(application.institutionName.length <=58){

    const text = `${application.institutionName} has been  successfully submitted. You have officially applied for the following`;
    const start_idx =0;
    const end_idx = 58;
    const first_text = text.slice(start_idx,end_idx);
    const last_text = text.slice(end_idx,text.length);
    const add_text = "has been successfully submitted. You have officially applied for the following";
    replaceArea({page:0,x:248,y:440,size:9,offset:4,width:275,height:15,text:first_text });
    //univerity name cover
    if(last_text.length<20)replaceArea({page:0,x:64,y:427,size:9,offset:4,width:455,height:15,text:`${last_text} ${add_text}`});
    else replaceArea({page:0,x:64,y:427,size:9,offset:4,width:430,height:15,text:`${last_text} `});    
}
else{
    const start_idx =0;
    const end_idx = 58;
    const first_text = application.institutionName.slice(start_idx,end_idx);
    const last_text = application.institutionName.slice(end_idx,application.institutionName.length);
    const add_text = "has been successfully submitted. You have officially applied for the following";
    replaceArea({page:0,x:248,y:440,size:9,offset:3,width:275,height:15,text:first_text });
    //univerity name cover
    if(last_text.length<20)replaceArea({page:0,x:64,y:427,size:9,offset:3,width:455,height:15,text:`${last_text} ${add_text}`});
    else replaceArea({page:0,x:64,y:427,size:9,offset:3,width:430,height:15,text:`${last_text.slice(0,28)} ${add_text}`});    
}
//univerity name cover
//replaceArea({page:0,x:64,y:427,size:9,offset:3,width:88,height:15,text:application.institutionName.length});
//programm 1
replaceArea({page:0,x:100,y:394,size:9,offset:3,width:415,height:15,text:application.programmes[0] });
//programm 2
replaceArea({page:0,x:100,y:370,size:9,offset:3,width:400,height:15,text:application.programmes[1]});
if(!application.programmes[1])replaceArea({page:0,x:80,y:370,size:9,offset:3,width:10,height:15,text:null});




for(const key in varistyCollegeTemplate.fields){
 for(const _key in student){
    if(key == _key){
    replaceArea({...varistyCollegeTemplate.fields[key],text:student[_key]});

    }
}
 for(const _key in application){
    if(key == _key){
    replaceArea({...varistyCollegeTemplate.fields[key],text:application[_key]});

    }
}

}

}else if (file.toLowerCase().includes("bursary")){

//add ones outside the JSON Object
//date
replaceArea({page:0,x:63,y:702,size:9,offset:3,width:350,height:15,text:`${generatedDate.getDay() } ${months[generatedDate.getMonth()] } ${generatedDate.getFullYear() }`});
//ref
replaceArea({page:0,x:84,y:685,size:9,offset:4,width:350,height:15,text:applicationReference});
//re
replaceArea({page:0,x:80,y:615.5,size:10,offset:0,width:200,height:15,text:`${application.institutionName} Bursary Application Details` ,bold:true});

//univerity name
//replaceArea({page:0,x:248,y:490,size:9,offset:3,width:275,height:15,text:`${application.institutionName } `});
//univerity name cover
//replaceArea({page:0,x:64,y:476,size:9,offset:3,width:36,height:15,text:null});
//univerity name
if(application.institutionName.length <=58){

    const text = `${application.institutionName} has been  successfully submitted.`;
    const start_idx =0;
    const end_idx = 58;
    const first_text = text.slice(start_idx,end_idx);
    const last_text = text.slice(end_idx,text.length);
    const add_text = "has been successfully submitted.";
    replaceArea({page:0,x:248,y:490,size:9,offset:3,width:275,height:15,text:first_text });
    //univerity name cover
    if(last_text.length<20)replaceArea({page:0,x:64,y:476,size:9,offset:3,width:455,height:15,text:`${last_text}`});
    else replaceArea({page:0,x:64,y:476,size:9,offset:3,width:430,height:15,text:`${last_text} `});    
}
else{
    const start_idx =0;
    const end_idx = 58;
    const first_text = application.institutionName.slice(start_idx,end_idx);
    const last_text = application.institutionName.slice(end_idx,application.institutionName.length);
    const add_text = "has been successfully submitted.";
    replaceArea({page:0,x:248,y:490,size:9,offset:3,width:275,height:15,text:first_text });
    //univerity name cover
    if(last_text.length<20)replaceArea({page:0,x:64,y:476,size:9,offset:3,width:455,height:15,text:`${last_text} ${add_text}`});
    else replaceArea({page:0,x:64,y:476,size:9,offset:3,width:430,height:15,text:`${last_text.slice(0,28)} ${add_text}`});    
}

for(const key in bursaryTemplate.fields){
 for(const _key in student){
    if(key == _key){
    replaceArea({...bursaryTemplate.fields[key],text:student[_key]});

    }
}
 for(const _key in application){
    if(key == _key){
    replaceArea({...bursaryTemplate.fields[key],text:application[_key]});

    }
}

}

}



// make it non editable
//pdfDoc.getPage().flatten();

const save_pdfBytes = await pdfDoc.save();
let save_name ="";
if(file.toLowerCase().includes("bursary"))save_name= `${student.firstName}_Bursary_Application_Confirmation.pdf`;
else if(file.toLowerCase().includes("varsity"))save_name= `${student.firstName}_Application_Confirmation.pdf`;

fs.writeFileSync(save_name,save_pdfBytes);

}
main().catch(console.error);

