export interface ScrapedPost {
  author: string;
  headline: string;
  text: string;
  emails: string[];
  postLink: string;
}

const AUTHORS: Array<[string, string]> = [
  ["Yash Parwani", "Career Advisor @ Recruit Roots Global Services LLC"],
  ["Priya Sharma", "Technical Recruiter @ Apex Systems"],
  ["Marcus Reed", "Sr. IT Recruiter @ TalentBridge Partners"],
  ["Deepika Nair", "Talent Acquisition @ CloudNine Staffing"],
  ["Jason Miller", "Hiring Manager @ Northfield Technologies"],
  ["Ananya Iyer", "Recruitment Lead @ Vertex Solutions"],
  ["Tom Becker", "Delivery Manager @ Insight Global"],
  ["Sara Ali", "Corporate Recruiter @ DataWorks Inc"],
  ["Kevin Osei", "Technical Sourcer @ BrightEdge Talent"],
  ["Neha Kulkarni", "Staffing Specialist @ ProStack Technologies"],
  ["Daniel Wright", "Client Partner @ Innominds"],
  ["Ritika Malhotra", "US IT Recruiter @ TekLeader Solutions"],
];

const DOMAINS = [
  "apexsystems.com",
  "talentbridge.io",
  "cloudninestaffing.com",
  "northfieldtech.com",
  "vertexsolutions.net",
  "insightglobal.com",
  "dataworksinc.com",
  "brightedgetalent.com",
  "prostacktech.com",
  "tekleader.com",
];

const SKILL_POOLS = [
  ["AWS", "Kubernetes", "Terraform", "Jenkins"],
  ["Python", "SQL", "dbt", "Airflow"],
  ["Java", "Spring Boot", "Microservices", "Kafka"],
  ["React", "Node.js", "TypeScript", "GraphQL"],
  ["Selenium", "Playwright", "API Testing", "CI/CD"],
  ["Power BI", "Tableau", "SQL", "Excel"],
  ["Azure", "Docker", "Helm", "GitHub Actions"],
  ["Snowflake", "Spark", "Databricks", "Python"],
];

function pick<T>(arr: T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length];
}

function firstName(author: string): string {
  return author.split(" ")[0].toLowerCase();
}

function activityId(seed: number): string {
  return String(7496207579703017473 + seed * 1370357).slice(0, 19);
}

/** Role-relevant, genuine hiring posts — the kind the filters should ACCEPT. */
function genuinePost(
  i: number,
  role: string,
  author: [string, string],
  withEmail: boolean
): ScrapedPost {
  const skills = pick(SKILL_POOLS, i);
  const locationTags = ["Remote (US)", "Dallas, TX (Hybrid)", "New York, NY", "Multiple Locations - US", "Onsite - Tampa, FL", "Remote - PST hours"];
  const loc = pick(locationTags, i);
  const openings = ["2", "3", "5", "multiple"];
  const emailLine = withEmail
    ? `Please share profiles at ${firstName(author[0])}@${pick(DOMAINS, i)} or DM me.`
    : "Apply via the link in comments.";
  const text = `Urgent Requirement: ${role} — W2 / Full-Time

We are hiring ${pick(openings, i)} ${role}(s) for our direct client. This is a ${loc} position with an immediate start.

Key skills: ${skills.join(", ")}.

Looking for someone who can join within 1-2 weeks. Full-time/W2 preferred; strong communication skills required.

${emailLine}

#hiring #jobs #${roleTokens(role)} #usajobs`;
  const emails = withEmail
    ? [`${firstName(author[0])}@${pick(DOMAINS, i)}`]
    : [];
  return {
    author: author[0],
    headline: author[1],
    text,
    emails,
    postLink: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId(i * 7 + 3)}/`,
  };
}

/** Bench-sales / vendor posts — the kind the filters must REJECT. */
function benchPost(i: number, author: [string, string]): ScrapedPost {
  const kinds = [
    `Bench Sales Alert! hotlist available

We have senior consultants on our bench ready to deploy: DevOps, Java Fullstack, Data Engineers, QA Automation, .NET, Salesforce. All with excellent communication and valid work authorization.

Bench sales recruiters and vendors, reach me at ${firstName(author[0])}@vendorbench.com for the updated hotlist.`,
    `C2C Hotlist - Bench available immediately

Sharing our benchsales hotlist for this week. Strong candidates on H1B/OPT across all technologies looking for C2C requirements only. Vendors and bench sales partners welcome.

Email: bench@${pick(DOMAINS, i + 4)}`,
    `Prime vendor needed for bench candidates!

Bench-sales opportunity: we supply pre-vetted consultants for your open C2C roles. Hit me up for the hot list.

Contact: ${firstName(author[0])}.bench@staffflow.net`,
  ];
  const text = pick(kinds, i);
  return {
    author: author[0],
    headline: author[1],
    text,
    emails: extractEmailsFrom(text),
    postLink: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId(i * 11 + 101)}/`,
  };
}

/** Posts with no email / no job signal — should be ignored silently. */
function noisePost(i: number, author: [string, string]): ScrapedPost {
  const kinds = [
    "Excited to share that I completed my certification this weekend! Big thanks to everyone who supported the journey. #growth #learning",
    "Nobody talks about how hard job hunting really is. 6 months, 400 applications. Keep going, your offer is coming.",
    "Happy to announce our team retreat photos are in! What an amazing group of people. #culture",
    "Thoughts on return-to-office? I wrote about our hybrid experiment over the last year — link in comments.",
  ];
  return {
    author: author[0],
    headline: author[1],
    text: pick(kinds, i),
    emails: [],
    postLink: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId(i * 13 + 201)}/`,
  };
}

/** Off-role hiring posts (with emails) — rejected by role relevance. */
function offRolePost(i: number, author: [string, string]): ScrapedPost {
  const roles = ["Salesforce Administrator", "SAP MM Consultant", "Marketing Manager", "UX Designer"];
  const r = pick(roles, i);
  const text = `Hiring now: ${r}

Immediate opening for a ${r}. Remote friendly, full-time role. Looking for 3+ years of hands-on experience.

Send resumes to ${firstName(author[0])}@otherdomain-hiring.com`;
  return {
    author: author[0],
    headline: author[1],
    text,
    emails: [`${firstName(author[0])}@otherdomain-hiring.com`],
    postLink: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId(i * 17 + 301)}/`,
  };
}

function extractEmailsFrom(text: string): string[] {
  const m = text.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g);
  return m ? m.map((s) => s.toLowerCase()) : [];
}

function roleTokens(role: string): string {
  return role.replace(/[^a-z0-9]/gi, "").toLowerCase() || "tech";
}

/**
 * Build a realistic "feed": mostly genuine role-relevant hiring posts, mixed
 * with bench-sales, off-role, and noise items so the filter pipeline is
 * exercised end to end. Deterministic shuffle for stable demos.
 */
export function generateSimulatedFeed(role: string, count = 60): ScrapedPost[] {
  const posts: ScrapedPost[] = [];
  for (let i = 0; i < count; i++) {
    const author = pick(AUTHORS, i * 5 + 2);
    const bucket = (i * 7 + 3) % 10;
    if (bucket <= 4) posts.push(genuinePost(i, role, author, true));
    else if (bucket === 5) posts.push(genuinePost(i, role, author, false));
    else if (bucket <= 7) posts.push(benchPost(i, author));
    else if (bucket === 8) posts.push(offRolePost(i, author));
    else posts.push(noisePost(i, author));
  }
  // de-dup by postLink
  const seen = new Set<string>();
  return posts.filter((p) => (seen.has(p.postLink) ? false : (seen.add(p.postLink), true)));
}
