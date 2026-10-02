// Rendered browser acceptance; requires an existing Playwright runtime, not a new app dependency.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { startFixture, stopFixture, secret, client } from "./phase1-fixture.mjs";

if(!process.env.ATOM_PLAYWRIGHT_MODULE||!isAbsolute(process.env.ATOM_UI_EVIDENCE??""))throw new Error("Set ATOM_PLAYWRIGHT_MODULE to an installed Playwright module and ATOM_UI_EVIDENCE to an absolute evidence directory outside source.");
const {chromium}=await import(pathToFileURL(process.env.ATOM_PLAYWRIGHT_MODULE).href);
const output=resolve(process.env.ATOM_UI_EVIDENCE);mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(tmpdir(),"atom-phase1-browser-"));
let server,browser,activePage;const errors=[],warnings=[],screenshots=[];
function observe(page){page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="warning")warnings.push(m.text());if(m.type()==="error"&&!m.text().includes("Failed to load resource"))errors.push(m.text());});}
async function visible(locator){await locator.waitFor({state:"visible",timeout:15000});}
async function shot(page,name){await page.screenshot({path:join(output,name),fullPage:true});screenshots.push(name);}
async function login(page,base,identifier,password){await page.goto(base+"/login");await page.getByLabel("Username or student number").fill(identifier);await page.getByLabel(/^Password/).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL(url=>url.pathname!=="/login");}
async function activateUI(page,base,identifier,activation){const password=secret();await login(page,base,identifier,activation);await visible(page.getByRole("heading",{name:"Choose your own password"}));await page.getByLabel("Current password",{exact:true}).fill(activation);await page.getByLabel(/^New password/).fill(password);await page.getByLabel("Confirm new password",{exact:true}).fill(password);await page.getByRole("button",{name:"Change password",exact:true}).click();await visible(page.getByRole("heading",{name:"Your subjects"}));return password;}
async function signOut(page){await page.getByRole("button",{name:"Open account menu"}).click();await page.getByRole("menuitem",{name:"Sign out",exact:true}).click();await visible(page.getByRole("heading",{name:"Sign in to ATOM"}));}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Page has unintended horizontal overflow");}
try{
  server=await startFixture(root,{compiled:true,host:"0.0.0.0"});browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();observe(page);activePage=page;
  page.setDefaultTimeout(15000);const ownerPassword=secret();
  await page.goto(server.base+"/setup");await visible(page.getByRole("heading",{name:"Create the installation owner"}));
  await page.getByLabel("Faculty name",{exact:true}).fill("UI Synthetic Owner");await page.getByLabel("Local username").fill("ui-owner");await page.getByLabel(/^Password/).fill(ownerPassword);await page.getByLabel("Confirm password",{exact:true}).fill(ownerPassword);await page.getByRole("button",{name:"Complete setup"}).click();
  await page.getByRole("link",{name:"Set up course",exact:true}).click();
  await page.getByText("Create a reusable course",{exact:true}).click();await page.getByLabel("Course code",{exact:true}).fill("UI-NEW");await page.getByLabel("Course title",{exact:true}).fill("Synthetic browser course");await page.getByRole("button",{name:"Save course definition"}).click();
  await page.getByLabel("Course",{exact:true}).locator("option",{hasText:"UI-NEW"}).waitFor({state:"attached"});
  await page.getByText("Create an academic term",{exact:true}).click();await page.getByLabel("Term label",{exact:true}).fill("Synthetic browser term");await page.getByRole("button",{name:"Save academic term"}).click();
  await page.getByLabel("Academic term",{exact:true}).locator("option",{hasText:"Synthetic browser term"}).waitFor({state:"attached"});
  await page.getByLabel("Offering display identity",{exact:true}).fill("UI Fixed-roster Pilot");await page.getByLabel("laboratory",{exact:true}).check();await page.getByRole("button",{name:"Save draft offering and continue"}).click();
  await visible(page.getByRole("heading",{name:"Teaching groups",exact:true}));const offeringId=new URL(page.url()).pathname.split("/").pop();
  const teachers=[];
  await page.getByText("Provision a faculty account",{exact:true}).click();
  for(const name of ["Lecture","Lab A","Lab B"]){
    const username=`ui-${name.toLowerCase().replaceAll(" ","-")}`;
    await page.getByLabel("Faculty display name",{exact:true}).fill(`UI ${name} Faculty`);await page.getByLabel("Faculty username",{exact:true}).fill(username);await page.getByRole("button",{name:"Create faculty identity"}).click();
    await page.getByRole("button",{name:"Issue activation",exact:true}).click();
    const input=page.getByLabel("Single-use activation password",{exact:true});await visible(input);
    teachers.push({name,username,activation:await input.inputValue()});
    await page.getByRole("button",{name:"Close and discard secret"}).click();
  }
  await page.getByText("Provision a faculty account",{exact:true}).click();
  for(const [index,name] of ["Lecture L","Lab A","Lab B"].entries()){
    await page.getByRole("button",{name:"Add teaching group",exact:true}).click();const row=page.locator(".setup-group-row").nth(index);
    await row.getByLabel("Group label",{exact:true}).fill(name);await row.getByLabel("Component",{exact:true}).selectOption(index===0?"lecture":"laboratory");await row.getByLabel(`UI ${teachers[index].name} Faculty`,{exact:true}).check();
  }
  for(const [index,name] of ["Lab A","Lab B"].entries()){
    await page.getByRole("button",{name:"Add association",exact:true}).click();const row=page.locator(".setup-link-row").nth(index);await row.getByLabel("Lecture",{exact:true}).selectOption({label:"Lecture L"});await row.getByLabel("Laboratory",{exact:true}).selectOption({label:name});
  }
  await shot(page,"01-teaching-groups-desktop.png");await noOverflow(page);
  await page.route("**/api/academic-setup/offerings/*/structure",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic save outage"})}));
  await page.getByRole("button",{name:"Save teaching groups and continue"}).click();await visible(page.getByRole("alert"));assert.equal(await page.locator(".setup-group-row").count(),3);assert.equal(await page.locator(".setup-group-row").nth(1).getByLabel("Group label",{exact:true}).inputValue(),"Lab A");
  await shot(page,"02-save-failure-retains-edits.png");await page.unroute("**/api/academic-setup/offerings/*/structure");await page.getByRole("button",{name:"Save teaching groups and continue"}).click();await visible(page.getByRole("heading",{name:"Saved roster · 0 students"}));
  // Cancellation is a read-only preview operation, never an academic mutation.
  await page.getByLabel("Student number",{exact:true}).fill("000100");await page.getByLabel("Full name",{exact:true}).fill("UI Cancelled Student");await page.getByLabel("Lecture L (lecture)",{exact:true}).check();await page.getByLabel("Lab A (laboratory)",{exact:true}).check();await page.getByRole("button",{name:"Add to review table"}).click();await page.getByRole("button",{name:"Preview roster",exact:true}).click();await visible(page.getByRole("button",{name:"Apply reviewed roster"}));await page.getByRole("button",{name:"Cancel unsaved roster"}).click();await visible(page.getByRole("heading",{name:"Saved roster · 0 students"}));
  await page.getByLabel("Student number",{exact:true}).fill("000101");await page.getByLabel("Full name",{exact:true}).fill("UI Student A");await page.getByLabel("Lecture L (lecture)",{exact:true}).check();await page.getByLabel("Lab A (laboratory)",{exact:true}).check();await page.getByRole("button",{name:"Add to review table"}).click();await page.getByRole("button",{name:"Preview roster",exact:true}).click();await page.getByRole("button",{name:"Apply reviewed roster"}).click();await visible(page.getByRole("heading",{name:"Saved roster · 1 student"}));
  await page.getByText("Paste a table (up to 200 students)",{exact:true}).click();await page.getByLabel("Student number ⇥ full name ⇥ group labels",{exact:true}).fill("000102\tUI Student B\tLecture L;Lab B\n000102\tUI Student B\tLecture L;Lab B");await page.getByRole("button",{name:"Load pasted rows for review"}).click();await page.getByRole("button",{name:"Preview roster",exact:true}).click();await visible(page.getByText("Duplicate student number in this batch",{exact:true}));assert.equal(await page.getByRole("button",{name:"Apply reviewed roster"}).count(),0);
  await page.getByRole("button",{name:"Remove row 2",exact:true}).click();await page.getByRole("button",{name:"Preview roster",exact:true}).click();await visible(page.getByRole("button",{name:"Apply reviewed roster"}));await shot(page,"03-roster-preview-desktop.png");await page.getByRole("button",{name:"Apply reviewed roster"}).click();await visible(page.getByRole("heading",{name:"Saved roster · 2 students"}));
  const studentHandoffs=[];
  for(const number of ["000101","000102"]){
    const row=page.locator("tbody tr").filter({hasText:number});await row.getByRole("button",{name:"Private hand-off"}).click();await page.getByRole("button",{name:"Issue activation",exact:true}).click();const input=page.getByLabel("Single-use activation password",{exact:true});await visible(input);studentHandoffs.push({number,activation:await input.inputValue()});await page.getByRole("button",{name:"Close and discard secret"}).click();
  }
  await page.setViewportSize({width:390,height:844});await noOverflow(page);await shot(page,"04-roster-mobile.png");await page.getByRole("button",{name:"Review saved setup",exact:true}).click();await visible(page.getByRole("heading",{name:"Review",exact:true}));await shot(page,"05-review-mobile.png");await noOverflow(page);
  const zoomContext=await browser.newContext({viewport:{width:720,height:500},deviceScaleFactor:2,storageState:await context.storageState()});const zoomPage=await zoomContext.newPage();observe(zoomPage);await zoomPage.goto(page.url());await visible(zoomPage.getByRole("heading",{name:"Review",exact:true}));await noOverflow(zoomPage);await shot(zoomPage,"06-review-200-percent.png");await zoomContext.close();await page.setViewportSize({width:1440,height:1000});await page.getByRole("button",{name:"Mark ready and open activities"}).click();await visible(page.getByRole("heading",{name:"UI-NEW · Activities"}));assert.ok((await page.locator("body").innerText()).includes("You manage this offering"));
  // A delayed previous-account setup response cannot populate the next account.
  let release,intercepted=false;const held=new Promise(done=>{release=done;});
  await page.route(`**/api/academic-setup/offerings/${offeringId}`,async route=>{const response=await route.fetch();intercepted=true;await held;await route.fulfill({response}).catch(error=>{if(!/already handled|closed|aborted/i.test(error.message))throw error;});});
  await page.goto(`${server.base}/course-setup/${offeringId}?step=2`,{waitUntil:"domcontentloaded"});
  for(let i=0;!intercepted&&i<100;i++)await new Promise(done=>setTimeout(done,50));assert.ok(intercepted);
  await signOut(page);teachers[1].password=await activateUI(page,server.base,teachers[1].username,teachers[1].activation);release();await page.unrouteAll({behavior:"wait"});
  assert.equal(await page.getByRole("link",{name:"Set up course",exact:true}).count(),0);assert.ok(!(await page.locator("body").innerText()).includes("UI Student B"));
  console.log("Browser setup, manual/paste roster, cancellation, error retention, mobile, zoom and delayed-account checks passed.");
  const lan=Object.values(networkInterfaces()).flat().find(a=>a?.family==="IPv4"&&!a.internal)?.address;
  if(!lan)throw new Error("No host LAN IPv4 address available for the required origin check");
  const lanBase=`http://${lan}:${server.port}`,lanContext=await browser.newContext({viewport:{width:1440,height:1000}}),teacherPage=await lanContext.newPage();observe(teacherPage);
  await login(teacherPage,lanBase,teachers[1].username,teachers[1].password);await teacherPage.locator(".subject-card").click();await teacherPage.getByRole("link",{name:"New activity",exact:true}).click();await visible(teacherPage.getByLabel("Activity title",{exact:true}));
  await teacherPage.getByLabel("Activity title",{exact:true}).fill("UI LAN activity");
  const localDate=new Date(Date.now()-60000);const formatted=new Date(localDate.getTime()-localDate.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await teacherPage.getByLabel("Opens",{exact:true}).fill(formatted);await visible(teacherPage.getByText("Saved to ATOM",{exact:true}));
  const activityId=new URL(teacherPage.url()).pathname.split("/")[4];await teacherPage.getByRole("button",{name:"Publish activity",exact:true}).click();await visible(teacherPage.getByText(/First publication permanently locks this offering/));await teacherPage.getByRole("button",{name:"Publish release",exact:true}).click();await visible(teacherPage.getByRole("heading",{name:"UI LAN activity",exact:true}));
  await shot(teacherPage,"07-lan-published-activity.png");
  const studentContext=await browser.newContext({viewport:{width:390,height:844}}),studentPage=await studentContext.newPage();observe(studentPage);
  await activateUI(studentPage,lanBase,studentHandoffs[0].number,studentHandoffs[0].activation);await studentPage.locator(".subject-card").click();await studentPage.getByRole("link",{name:/UI LAN activity/}).click();
  await studentPage.locator('input[type="file"]').setInputFiles({name:"solution.py",mimeType:"text/x-python",buffer:Buffer.from("# UI synthetic submission\n")});await studentPage.getByRole("button",{name:"Upload submission",exact:true}).click();await visible(studentPage.locator(".submission-receipt"));await noOverflow(studentPage);await shot(studentPage,"08-student-submission-mobile.png");
  // Owner sees lock, but still cannot become an evaluator.
  await signOut(page);await login(page,server.base,"ui-owner",ownerPassword);await page.goto(`${server.base}/course-setup/${offeringId}?step=1`);await visible(page.getByText(/Configuration locked since/));assert.ok(await page.getByRole("button",{name:"Add teaching group",exact:true}).isDisabled());await shot(page,"09-locked-setup.png");
  const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));assert.ok([...storage.local,...storage.session].every(k=>!k.includes("setup")&&!k.includes("roster")&&!k.includes("activation")));
  assert.equal(errors.length,0,errors.join("\n"));assert.equal(warnings.length,0,warnings.join("\n"));
  const report={result:"passed",browser:await browser.version(),desktop:[1440,1000],mobile:[390,844],zoom:"200% equivalent reflow: 720 CSS pixels at deviceScaleFactor 2; browser chrome zoom not automated",pageTitle:await page.title(),checks:["fresh owner UI","new course/term/offering UI","three distinct faculty hand-offs","teaching map and links","503 retains edits","manual roster apply","paste duplicate validation and apply","preview cancellation","private activation","manager-only handoff","delayed response after account switch","host-browser LAN activity IDs/publish","student activation/upload","persistent publication lock","no unexpected page/console errors","no setup/roster/credential storage keys"],screenshots,unexpectedConsoleErrors:errors.length,consoleWarnings:warnings.length,expectedHttpErrors:[503],physicalSecondClient:false};
  writeFileSync(join(output,"browser-results.json"),JSON.stringify(report,null,2));console.log("Phase 1 rendered browser acceptance passed; sanitized evidence saved outside the source tree.");
}catch(error){ if(activePage){await activePage.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});console.error((await activePage.locator("body").innerText().catch(()=>"")).slice(0,7000));} throw error; }finally{await browser?.close();await stopFixture(server);if(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes("atom-phase1-browser-"))rmSync(root,{recursive:true,force:true});}
