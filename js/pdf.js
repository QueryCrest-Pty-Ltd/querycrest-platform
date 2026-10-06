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
const { PDFDocument } = require('pdf-lib');
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

const pdfBytes = fs.readFileSync("C:/Users/USER-PC/Downloads/Student-Details-Varsity-College.pdf");
const pdfDoc = await PDFDocument.load(pdfBytes);

const form = pdfDoc.getForm();
const fields = form.getFields();
console.log(form.getFields());
fields.forEach((field) => {
  const name = field.getName();
  const type = field.constructor.name; // e.g., PDFTextField, PDFCheckBox
  console.log(`${name} -> ${type}`);
});
}
main().catch(console.error);

