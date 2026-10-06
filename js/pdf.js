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

const generatedDate = new Date();
const student = {firstName:null,
                 surnameAndInitials:null,
                 email:null
};
const applicationReference = "";
const application = {studentNumber:null   ,  
                     institutionName:null,
                     placementPeriod:null,
                     portalPassword:null,
                     itsPin:null,
                     shortName:null,
                     programmes:[]
};


const varistyCollegeTemplate = {templateId:"student-details-varsity-college",fields:{
generatedDate:{page:0,x:72,y:690,size:9},
applicationReference:{page:0,x:72,y:674,size:9},
firstName:{page:0,x:92,y:610,size:9},
surnameAndInitials:{page:0,x:165,y:555,size:9},
studentNumber:{page:0,x:165,y:535,size:9},
institutionName:{page:0,x:165,y:515,size:9},
placementPeriod:{page:0,x:165,y:495,size:9},
portalPassword:{page:0,x:165,y:455,size:9},
itsPin:{page:0,x:165,y:435,size:9}
 }};

const bursaryTemplate = {templateId:"student-details-bursary",fields:{
generatedDate:{page:0,x:72,y:690,size:9},
applicationReference:{page:0,x:72,y:674,size:9},
firstName:{page:0,x:92,y:610,size:9},
surnameAndInitials:{page:0,x:165,y:555,size:9},
studentNumber:{page:0,x:165,y:535,size:9},
institutionName:{page:0,x:165,y:515,size:9},
placementPeriod:{page:0,x:165,y:495,size:9},
portalPassword:{page:0,x:165,y:455,size:9},
itsPin:{page:0,x:165,y:435,size:9}
 }};
const file = "C:/Users/USER-PC/Downloads/Student-Details-Varsity-College.pdf";
const pdfBytes = fs.readFileSync(file);
const pdfDoc = await PDFDocument.load(pdfBytes);


async function replaceArea({page,x,y,width,height,text,size=9}){
    const _page = pdfDoc.getPages()[page];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    //cover the old template values/placeholders.
    _page.drawRectangle({x,y,width,height,color:(1,1,1),borderWidth:0});

    //draw new values
    _page.drawText(string(text ??''),{x,y:y+2,size,font,color:rgb(0,0,0),maxWidth:width});
}

//replace values

for(const key in varistyCollegeTemplate.fields){
 for(const _key in student){
    if(key === _key){
    replaceArea({...varistyCollegeTemplate.fields[key],width:250,height:14,text:student[_key]});

    }
}
 for(const _key in application){
    if(key === _key){
    replaceArea({...varistyCollegeTemplate.fields[key],width:250,height:14,text:application[_key]});

    }
}


}

// make it non editable
//pdfDoc.getPage().flatten();

const save_pdfBytes = await pdfDoc.save();
let save_name ="";
if(file.toLowerCase().includes("bursary"))save_name= `${student.firstName}_Bursary_Application_Confirmation`;
else if(file.toLowerCase().includes("varsity"))save_name= `${student.firstName}_Application_Confirmation`;

fs.writeFileSync(save_name,save_pdfBytes);

}
main().catch(console.error);

