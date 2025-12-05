#!/usr/bin/env node
// extractEmail
// Extract the last specifid (defaults to 100) emails from <user@site.com>.

// Import dependencies.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';

// Import project dependencies.
import { configEmail } from './configEmailExtraction.js';

// Define options to be used in array.
const optSet   = ["from", "to", "date", "subject", "body"];

// Task set object for specific functions, and help output.
const taskSets = {
 "stop": "Get the number from STOP request, and remove from messaging."
};

// Help message.
const help = `
 extractEmail
 Extract the last specifid (defaults to 100) emails from <user@site.com>.

 useage: extractEmail [1]

 [1] = option | task set

 Options:
  -h, --help
  from
  to
  date
  subject
  body

 Task Sets:`;

// Parameter variables.
const allPar = process.argv;
var extract, count;

// Set parameter variables.
if (allPar.length < 3) {
 extract = "all";
} else {
 extract = allPar[2];
 if (allPar.length >= 4) count = allPar[3];
 else count = 100;
}

/************************************* SUPPORT FUNCTIONS *************************************/
// Check if a task exists
function checkExtractTask(opt) {
  const taskPath = path.resolve('./extractEmailTasks', `${opt}.js`);
  if (fs.existsSync(taskPath)) return taskPath;
  return null;
}

// Dynamically import and call task
async function callExtractEmailTask(opt, headersPart, subject, body) {
  const taskPath = checkExtractTask(opt);
  if (!taskPath) return false;

  try {
    const fileUrl = pathToFileURL(taskPath).href;
    const taskModule = await import(fileUrl);

    if (taskModule.default && typeof taskModule.default === 'function') {
      taskModule.default(headersPart, subject, body, setVal, outputToTerminal);
      return true;
    }
  } catch (err) {
    console.error(`Error loading task ${opt}:`, err);
  }

  return false;
}


// Set the output value.
var val;
const setVal = (opt, headersPart, subject, body) => {
  if (opt == "subject") val = subject;
  else if (opt == "body") val = body;
  else val = headersPart[opt];
};

// Constant output to terminal.
var emailCount = 0;
const outputToTerminal = (opt, val, h) => {
  if (h == 0) {
    console.log(`\n=== Email #${emailCount + 1} ===`);
    emailCount++;
  }
  console.log(opt[0].toUpperCase() + opt.substr(1,) + ":", val);
};

const findTextPart = (parts) => {
  for (const part of parts) {
    if (part.type === 'text' && part.subtype === 'plain') {
      return part;
    }
    if (part.parts) {
      const nested = findTextPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
};

// Output task sets to help.
var optionCall = 0;
const handleTaskSets = (opt) => {
  for (let prop in taskSets) {
    if (opt == prop) {
      optionCall = 2;
      return;
    } else if (opt == "--help") {
       console.log(`  ${prop}    -    ${taskSets[prop]}`);
       optionCall = 3;
       return;
    }
  }
  if (optionCall == 0) optionCall = 1;
};

// Handle options.
const handleOption = (opt, headersPart, subject, body) => {
  let allArr = [];
  let loopOptSet = (seq) => {
    for (let i = 0; i < optSet.length; i++) {
     if (seq == 1) {
       if (opt == optSet[i]) {
         setVal(opt);
         outputToTerminal(opt, val, 0);
       } else {
         allArr.push(optSet[i]);
       }
     } else {
        setVal(optSet[i]);
        outputToTerminal(optSet[i], val, i);
     }
    }
  };
  loopOptSet(1);

  // all outputs
  if (allArr.length == optSet.length) {
    loopOptSet(2);
  }
};

const handleTask = async (opt, headersPart, subject, body) => {
  // Only one case now: dynamically call external task
  const executed = await callExtractEmailTask(opt, headersPart, subject, body);
  if (!executed) {
    console.log(`No task named "${opt}" exists or task file not found.`);
  }
};


/*********************************************************************************************
                                         MAIN FUNCTION
*********************************************************************************************/
async function extractEmail() {
  if (extract == "-h" || extract == "--help") {
    console.log(help);
    handleTaskSets("--help");
    process.exit();
  } else {
    try {
      const connection = await imaps.connect(configEmail);
      await connection.openBox('INBOX');

      const searchCriteria = ['ALL'];
      const fetchOptions = {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
        struct: true
      };

      const messages = await connection.search(searchCriteria, fetchOptions);

      // Look at the last 100 messages
      const lastMessages = messages.slice(-count);

      for (const [i, msg] of lastMessages.entries()) {
        const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
        let subject = headersPart.subject || '';
        if (Array.isArray(subject)) subject = subject.join(' ');

        // Check if task set or option.
        handleTaskSets(extract);

        const textPart = findTextPart(msg.attributes.struct);
        let body = '';
        if (textPart) body = await connection.getPartData(msg, textPart);

        // If option, else handle taske.
        if (optionCall == 1) {
          handleOption(extract, headersPart, subject, body);
        } else {
          handleTask(extract, headersPart, subject, body);
        }
      }
      await connection.end();
    } catch (err) {
      console.error('Error fetching emails:', err);
    }
  }
}

// Call main function.
extractEmail();
