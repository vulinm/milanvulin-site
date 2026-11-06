// Suggested questions for the chat. Each of the three slots is its own line of thought: the first question is shown
// at the start, and every answered question is replaced by the next one in the same slot. Questions are written to
// stand on their own ("he", "this site"), because the chat only remembers the last few messages. They hold no facts
// about Milan's profile: the answers come from the model, not from this file.
export const QUESTION_SLOTS: string[][] = [
  [
    "What does Milan work on?",
    "What did he do in his most recent role?",
    "How has his career developed over the years?",
    "What was his on-call and incident work like?",
    "Which programming languages does he use?",
    "Does he know SQL?",
    "What has he built outside of work?",
    "What is OwnForge?",
    "What is his education?",
    "What kind of role is he looking for next?",
    "Where is he based, and can he work remotely?",
  ],
  [
    "How does this site work?",
    "What is this site built with?",
    "How does my request get from the browser to the API?",
    "Why is there no database?",
    "Where does the chat model run, and why not a hosted API?",
    "How does the chat stay safe from spam?",
    "What does the site store about visitors?",
    "How is the home server protected from the internet?",
    "How are the numbers in Ship it measured?",
    "What does the ping card measure?",
    "How is a change tested before it goes live?",
  ],
  [
    "Why a pull-based pipeline?",
    "What is the difference between pull-based and push-based deploys?",
    "Why not just SSH into the server from GitHub Actions?",
    "How does the server know a new version exists?",
    "How long does it take from a push to the live site?",
    "What happens if a deploy fails or the server is offline?",
    "How would he roll back a bad release?",
    "Why not Kubernetes or k3s?",
    "How does this compare to GitOps tools like Argo CD or Flux?",
    "Where are secrets kept in this setup?",
    "When would push-based be the better choice?",
  ],
];
