import type { ActivityDocumentV1, RichTextNode } from "./activity-content.js";
import type { ActivityBlueprintV1, ActivityPart, RubricCriterion, SubmissionRequirement } from "./activity-blueprint.js";

export interface AuthoringStressFixture {
  id: string;
  title: string;
  gradingPeriod: "midterm" | "final_term";
  document: ActivityDocumentV1;
  blueprint: ActivityBlueprintV1;
}

const text = (value: string): RichTextNode => ({ type: "text", text: value });
const paragraph = (value: string): RichTextNode => ({ type: "paragraph", content: [text(value)] });
const heading = (value: string, level: 1 | 2 | 3 = 2): RichTextNode => ({ type: "heading", attrs: { level }, content: [text(value)] });
const code = (value: string, language = "python"): RichTextNode => ({ type: "codeBlock", attrs: { language }, content: [text(value)] });
const list = (items: string[]): RichTextNode => ({ type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })) });
const table = (rows: string[][]): RichTextNode => ({ type: "table", content: rows.map((row, rowIndex) => ({ type: "tableRow", content: row.map((cell) => ({ type: rowIndex === 0 ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [paragraph(cell)] })) })) });
const section = (id: string, title: string, nodes: RichTextNode[], kind: "overview" | "requirements" | "submission_notes" | "custom" = "custom") => ({ id, kind, title, content: { type: "doc", content: nodes } as RichTextNode });
const document = (prefix: string, overview: string, requirements: string[], extras: RichTextNode[] = []): ActivityDocumentV1 => ({ version: 1, sections: [section(`${prefix}-overview`, "Activity overview", [paragraph(overview), ...extras], "overview"), section(`${prefix}-requirements`, "Requirements", [list(requirements)], "requirements"), section(`${prefix}-submission`, "Submission notes", [paragraph("Submit only the requested evidence. Keep filenames stable so ATOM can validate the manifest without running your code.")], "submission_notes")] });

function part(prefix: string, number: number, title: string, requirements: string[], sample?: string): ActivityPart {
  return { id: `${prefix}-part-${number}`, shortLabel: `Level ${number}`, title, contentDocument: { version: 1, sections: [section(`${prefix}-part-${number}-requirements`, "Level requirements", [list(requirements), ...(sample ? [heading("Sample implementation shape", 3), code(sample)] : [])], "requirements")] } };
}

function requirement(id: string, label: string, filenameTemplate: string, partId: string | null, extensions = [".py"]): SubmissionRequirement { return { id, partId, label, kind: filenameTemplate.includes("*") ? "file_set" : "file", filenameTemplate, allowedExtensions: extensions, minCount: 1, required: true }; }
function criterion(id: string, title: string, points: number, evidence: string, partId: string | null = null): RubricCriterion { return { id, partId, title, description: "Evidence is checked by the faculty evaluator.", fullCreditEvidence: evidence, points }; }
function blueprint(parts: ActivityPart[], requirements: SubmissionRequirement[], rubric: RubricCriterion[], validationMode: "strict" | "warning" | "descriptive" = "warning", progression: "sequential" | "independent" = "sequential"): ActivityBlueprintV1 { return { version: 1, mode: parts.length ? "progressive" : "simple", progression: parts.length ? progression : "independent", parts, submission: { version: 1, delivery: requirements.length > 1 ? "zip" : "either", validationMode, allowExtraFiles: false, requirements }, rubric: rubric.length ? { version: 1, mode: parts.length ? "per_part" : "overall", expectedPoints: rubric.reduce((sum, item) => sum + item.points, 0), visibleToStudents: true, criteria: rubric } : null }; }

const commandParts = [
  part("command", 1, "Process the basic command set", ["Implement process_commands(commands).", "Return resource totals after ADD and REMOVE commands."], "def process_commands(commands):\n    pass"),
  part("command", 2, "Organize commands into functions", ["Separate parsing, validation, and mutation.", "Preserve Level 1 behavior."], "def parse_command(line):\n    pass"),
  part("command", 3, "Validate the complete dataset", ["Reject malformed quantities and unknown resources.", "Continue processing after invalid commands."]),
  part("command", 4, "Produce the final reports", ["Generate the required summary and alerts.", "Keep all earlier levels working."]),
];

export const AUTHORING_STRESS_FIXTURES: AuthoringStressFixture[] = [
  {
    id: "stress-command-resource-processor", title: "Command-Based Resource Processor", gradingPeriod: "midterm",
    document: document("command", "Build a Python resource processor in four cumulative levels. Each level extends the same program while preserving the previous command behavior.", ["Use required functions rather than one monolithic loop.", "Treat input commands as data; do not use eval()."], [table([["Command", "Meaning"], ["ADD water 5", "Increase water by five"], ["REMOVE food 2", "Decrease food by two"]])]),
    blueprint: blueprint(commandParts, commandParts.map((item, index) => requirement(`command-file-${index + 1}`, `${item.shortLabel} source`, `{last_name}_{first_name}_Level${index + 1}.py`, item.id)), commandParts.map((item) => criterion(`command-rubric-${item.id}`, item.shortLabel, 25, "Required behavior and function boundary are present.", item.id)), "strict"),
  },
  {
    id: "stress-rpg-decision-engine", title: "RPG Decision Engine", gradingPeriod: "midterm",
    document: document("rpg", "Resolve a turn-based encounter by applying rules in their exact priority order. Trace data must explain why the winning action was chosen.", ["Higher-priority rules short-circuit lower-priority rules.", "Ties use the deterministic action order in the specification."], [heading("Priority order", 2), list(["Prevent a fatal incoming attack.", "Use a guaranteed finishing move.", "Restore a depleted resource.", "Choose the highest expected-value legal action."]), code("TURN hp=8 mana=4 enemy_hp=11\nACTION guard\nTRACE fatal-risk rule", "text")]),
    blueprint: blueprint([part("rpg", 1, "Legal actions", ["Filter actions by resource and cooldown rules."]), part("rpg", 2, "Priority rules", ["Apply defensive and finishing rules before heuristics."]), part("rpg", 3, "Deterministic traces", ["Return the selected action and the first matching rule."]), part("rpg", 4, "Complete encounter", ["Process multiple turns without hidden global state."])], [requirement("rpg-source", "Decision engine", "decision_engine.py", "rpg-part-4"), requirement("rpg-traces", "Trace samples", "trace_*.txt", "rpg-part-3", [".txt"])], [criterion("rpg-priority", "Priority correctness", 40, "All higher-priority rules win before heuristics.", "rpg-part-2"), criterion("rpg-trace", "Trace clarity", 25, "Each decision identifies the first matching rule.", "rpg-part-3"), criterion("rpg-complete", "Encounter behavior", 35, "Multiple-turn inputs remain deterministic.", "rpg-part-4")]),
  },
  {
    id: "stress-configuration-delimiter-auditor", title: "Configuration Delimiter Auditor", gradingPeriod: "midterm",
    document: document("delimiter", "Write a console program that audits nested (), [], and {} delimiters in configuration text while ignoring delimiters inside quoted values.", ["Report the first invalid character and its 1-based position.", "Report unclosed delimiters from innermost to outermost."], [code("Input: server={ports:[80,443], note:\"ignore ( here\"}\nOutput: Missing } opened at 8", "text")]),
    blueprint: blueprint([], [requirement("delimiter-source", "Auditor source", "delimiter_auditor.py", null)], [criterion("delimiter-correct", "Delimiter analysis", 60, "Correct first-error position for valid, mismatched, and unclosed input."), criterion("delimiter-quotes", "Quoted content", 25, "Escaped quotes and delimiters inside strings are ignored."), criterion("delimiter-quality", "Program structure", 15, "Stack operations and scanning logic are readable.")], "warning"),
  },
  {
    id: "stress-archive-range-locator", title: "Archive Range Locator", gradingPeriod: "midterm",
    document: document("range", "Use recursive binary search to locate the first and last positions of a target archive identifier in sorted records.", ["The locator must remain recursive.", "Return (-1, -1) when the identifier does not exist.", "Include a trace showing the shrinking search interval."], [code("records = [101, 104, 104, 104, 120]\nlocate_range(records, 104)  # (1, 3)", "python")]),
    blueprint: blueprint([], [requirement("range-source", "Recursive locator", "archive_range.py", null), requirement("range-trace", "Search trace", "range_trace.txt", null, [".txt"])], [criterion("range-recursive", "Recursive boundary search", 50, "Both boundaries are found without linear scanning."), criterion("range-edge", "Edge cases", 30, "Empty, singleton, absent, and all-equal inputs are correct."), criterion("range-trace-rubric", "Trace evidence", 20, "Trace demonstrates logarithmic interval reduction.")], "strict"),
  },
  {
    id: "stress-campus-emergency-routes", title: "Campus Emergency Routes", gradingPeriod: "final_term",
    document: document("routes", "Model campus buildings as a weighted graph and compute safe emergency routes while closures and capacity restrictions change the usable edges.", ["Reject routes using a closed corridor.", "Prefer lower total risk before travel distance.", "Handle disconnected buildings and repeated updates."], [heading("Edge cases", 2), list(["Start and destination are the same.", "All exits from a building are closed.", "Two routes have equal risk and distance.", "An update refers to an unknown building."]), table([["From", "To", "Distance", "Risk", "Capacity"], ["LAB", "QUAD", "120", "2", "40"], ["QUAD", "GYM", "85", "1", "80"]])]),
    blueprint: blueprint([], [requirement("routes-source", "Route planner", "campus_routes.py", null), requirement("routes-data", "Graph dataset", "campus_graph.csv", null, [".csv"]), requirement("routes-report", "Scenario report", "emergency_report.txt", null, [".txt"])], [criterion("routes-model", "Graph model", 25, "Updates do not corrupt unrelated vertices or edges."), criterion("routes-path", "Route selection", 45, "Risk, distance, closures, and deterministic ties are handled."), criterion("routes-edge", "Edge cases", 20, "Disconnected and malformed cases are reported safely."), criterion("routes-evidence", "Technical report", 10, "Report explains chosen routes with totals.")], "warning"),
  },
  {
    id: "stress-field-kit-loading", title: "Field Kit Loading", gradingPeriod: "final_term",
    document: document("kit", "Use dynamic programming to choose field-kit items under weight and volume limits. The submitted trace must expose the state transition, not only the final list.", ["Maximize utility, then minimize unused capacity for ties.", "Each item is either selected once or not selected.", "Reconstruct the selected item set."], [table([["Item", "Weight", "Volume", "Utility"], ["Water filter", "3", "2", "9"], ["Radio", "2", "3", "8"], ["Medical kit", "4", "4", "13"]]), { type: "blockMath", attrs: { latex: "DP[i,w,v] = \\max(DP[i-1,w,v], u_i + DP[i-1,w-w_i,v-v_i])" } }]),
    blueprint: blueprint([], [requirement("kit-source", "Dynamic-programming solution", "field_kit.py", null), requirement("kit-table", "State trace", "dp_trace.csv", null, [".csv"]), requirement("kit-notes", "Complexity notes", "complexity.txt", null, [".txt"])], [criterion("kit-state", "State definition", 20, "Dimensions and base cases are correct."), criterion("kit-transition", "Transition", 35, "Include/exclude recurrence respects both capacities."), criterion("kit-reconstruct", "Reconstruction", 25, "Selected items match the optimal utility and tie rule."), criterion("kit-analysis", "Trace and complexity", 20, "Trace is interpretable and complexity is justified.")], "descriptive"),
  },
];
