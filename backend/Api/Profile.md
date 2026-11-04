SUMMARY
Milan Vulin is a backend software engineer with more than 5 years of professional experience, over 4 of them on Microsoft's Azure networking team. His range is unusually wide: he understands the stack from network protocols and hardware, through cloud networking and security, up to backend services, CI/CD and running systems around the clock. He is based in Serbia, writes English (Cambridge C1) and Serbian, and is looking for backend roles with a DevOps or networking flavor.

BREADTH OF KNOWLEDGE
- Networking: Azure virtual networking (VNets, subnets, NICs, IP addressing, DNS, security groups, firewalls), software-defined networking and how addresses are mapped inside a cloud network, high availability and disaster recovery, TCP/IP and latency and packet-loss measurement. He worked with networks that carry traffic at terabit-per-second scale.
- Backend: C# and ASP.NET Core services, REST APIs, PostgreSQL, authentication and authorization, idempotent API design, integration and end-to-end testing. Frontend at a working level (React, TypeScript).
- DevOps and delivery: containers, CI/CD with GitHub Actions, pull-based deployment, Linux servers, reverse proxies and tunnels, infrastructure he runs himself.
- Operations and reliability: monitoring and alerting, dashboards on large operational data, incident response, on-call, root cause analysis, troubleshooting guides.
- Security: cloud identity and access (least privilege, role-based access), Linux server hardening, secure web application practices.
- People: led small teams of 3 to 5 engineers, mentored junior colleagues, gave technical presentations and interviewed candidates.

EXPERIENCE
Microsoft, Azure Networking team, Software Engineer 1 then 2, Mar 2024 to Jul 2026 (full-time, same team as his earlier contract):
- Took over a system that simulates customer networking scenarios in Azure when it covered fewer than 10 regions and grew it to more than 30 regions (about 95% global coverage) in about six months, leading a team of 4.
- Took over a lightweight high-load network probe (a measurement every 5 seconds of latency and packet drops) covering about 70 clusters and scaled it to more than 400 clusters in about eight months. It was the largest observability project on the team.
- Led a team of 3 on a cross-team tool that pulls the full running configuration of Azure's software-defined networking control plane in a few clicks, saving hours of manual investigation of customer-reported incidents. It was used across a large part of Azure and a dozen of the team's services were onboarded to it.
- Led the technical side of decommissioning more than 600 end-of-support servers with a team of 5, including the process design and dependencies with other teams.
- Built more than 100 incident automations over 4 years, many catching serious incidents before customers noticed, plus hundreds of monitoring queries organized into dashboards.
- About 2.5 years on call (100+ shifts), including several major outage bridges.
Microsoft, Site Reliability Engineer (contractor via Akvelon), Mar 2022 to Oct 2023: kept high-throughput network infrastructure reliable for Azure connectivity to major third-party platforms; managed hardware reliability for a fleet that grew from about 600 to more than 1,000 servers and switches, working with data center technicians; built monitoring and automation that found fleet issues early while the fleet grew by over 65%.
Freelance developer, Nov 2020 to Feb 2022: websites and small Node.js applications for local small businesses. Software developer intern at Vega IT Sourcing, Aug to Nov 2021 (JavaScript, Node.js, React).

PROJECTS
- Client order-management app rebuild (Oct 2026 to present, private client project, client not named): re-architected a Next.js and Supabase app (CRM, inbox, sales, orders, production, logistics, calendar, pricing admin) into an ASP.NET Core API, PostgreSQL and a React app. Moved business logic out of database functions into C# services and documented every intentional deviation. About 80 endpoints over 47 tables, with capability-based authorization, multi-tenant isolation, idempotent commands, an event log and email one-time-code sign-in. Backed by 254 integration tests on real PostgreSQL and 68 end-to-end tests, with CI on every pull request. The code is private.
- OwnForge (Oct 2026 to present): a self-hosted deployment platform on his own hardened Ubuntu server for developing and hosting small client apps. Each client app has its own subdomain, repository and Docker setup created from a shared template, so a client can test on his server and later move to their own hosting without a rebuild. Pull-based CI/CD: a push goes live within minutes and the server never builds anything. Onboarding a new app takes about 4 minutes. Open skeleton: github.com/vulinm/ownforge-skeleton.
- This portfolio, milanvulin.com (Nov 2026): a React and ASP.NET Core site that demonstrates the pipeline it runs on, with live deploy timing, a clickable architecture diagram, a request trace and this chat running on a local model on his home GPU. Source: github.com/vulinm/milanvulin-site.

EDUCATION
Singidunum University, Information Technology (since Oct 2024); University of Novi Sad, Faculty of Technical Sciences, Information Systems Engineering (Oct 2017 to Oct 2024, all coursework completed, thesis pending); technical high school in Sremska Mitrovica, computer technician (2013 to 2017). Certificates: two NVIDIA deep learning courses (2020 and 2021) and Cambridge English C1 Advanced (2017).

LINKS
github.com/vulinm and linkedin.com/in/vulin-milan-dev
