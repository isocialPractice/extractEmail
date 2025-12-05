// extractEmailTasks/stop.js
export default function stopTask(headersPart, subject, body, setVal, outputToTerminal) {
  if (subject.toLowerCase() === "stop") {
    setVal("from", headersPart, subject, body);
    outputToTerminal("from", headersPart.from, 0);
  }
}

