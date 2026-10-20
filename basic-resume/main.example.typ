#import "resume.typ": *

// Copy this file to main.typ and replace everything in it with your own details.
// main.typ and the compiled PDF are not tracked: they are yours.
#let name = "Alex Rivera"
#let location = "Springfield, USA"
#let email = "alex.rivera@example.com"
#let github = "github.com/example"
#let linkedin = "linkedin.com/in/example"
#let phone = "+1 (555) 010-0100"
#let personal-site = "none"

#show: resume.with(
  author: name,
  // All the lines below are optional.
  location: location,
  email: email,
  linkedin: linkedin,
  phone: phone,
  accent-color: "#26428b",
  font: "Liberation Sans",
  paper: "us-letter",
  font-size: 10.5pt,
  margin: 0.6in,
  author-position: left,
  personal-info-position: left,
)

/*
* Lines that start with == are formatted into section headings
* #edu(dates: "", degree: "", gpa: "", institution: "", location: "", consistent: false)
* #work(company: "", dates: "", location: "", title: "")
* #project(dates: "", name: "", role: "", url: "")
* #certificates(name: "", issuer: "", url: "", date: "")
* #extracurriculars(activity: "", dates: "")
*/
== Work Experience

#work(
  title: "Software Engineer",
  location: "Springfield, USA",
  company: "Example Corporation",
  dates: dates-helper(start-date: "Jan 2024", end-date: "Present"),
)
- *Order service:* Rebuilt the order pipeline as three Python services behind a queue, cutting median processing time from 40 seconds to 6.
- *Testing:* Added contract tests between services so a breaking change fails in CI instead of in production.

== Projects

#project(
  name: [Trailmap #strong(delta: -300)[| Route planner (TypeScript, PostgreSQL)]],
  dates: dates-helper(start-date: "Jun 2023", end-date: "Present"),
)
- Plans multi-day hiking routes from open elevation data and serves them from a small API with offline-capable maps.

== Education

#edu(
  institution: "Example State University",
  location: "Springfield, USA",
  dates: dates-helper(end-date: "2023"),
  degree: "Bachelor of Science, Computer Science",
  consistent: true
)
