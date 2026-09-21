"use client";

import { Meeting } from "@/types";
import { formatIST } from "@/lib/dateUtils";
import { Download, Loader2, FileText } from "lucide-react";
import { useState, useRef } from "react";
// @ts-ignore - html2pdf.js types are provided in src/types/html2pdf.d.ts
import html2pdf from "html2pdf.js";
import {
  MoMHeader,
  MetadataGrid,
  AgendaSection,
  DiscussionSection,
  DecisionsSection,
  ActionItemsTable,
  OpenIssuesTable,
  NextStepsSection,
  MoodOfClientSection,
  OutOfScopeSection,
  ClosingSection,
} from "./MoMSections";

// Helper function to capitalize participant names properly
function capitalizeParticipantNames(names: string): string {
  return names
    .split(",")
    .map(name => {
      const trimmed = name.trim();
      if (!trimmed) return "";
      // Check if already properly capitalized (each word starts with uppercase)
      const words = trimmed.split(/\s+/);
      const isAlreadyCapitalized = words.every(word =>
        word.length > 0 && word[0] === word[0].toUpperCase()
      );
      if (isAlreadyCapitalized) {
        return trimmed;
      }
      // Capitalize first letter of each word
      return words
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    })
    .filter(name => name.length > 0)
    .join(", ");
}

interface MOMViewerProps {
  meeting: Meeting;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

// =====================================================
// TYPES FOR PARSED MoM DATA
// =====================================================

export interface MOMMetadata {
  headerLine?: string;
  meetingTitle?: string;
  subtitle?: string;
  date?: string;
  meetingType?: string;
  platform?: string;
  projectOrAccount?: string;
  facilitator?: string;
  participants?: string;
  topicsCovered?: string;
  duration?: string;
  companyName?: string;
}

export interface DiscussionSection {
  number: string;
  title: string;
  summary?: string;
  points: string[];
}

export interface ActionItem {
  id: number;
  action: string;
  owner: string;
  priority: "Immediate" | "High" | "Medium" | "Low";
  status: "Open" | "In Progress" | "Closed" | "TBD";
}

export interface OpenIssue {
  id: number;
  issue: string;
  context: string;
}

export interface ParsedMOM {
  metadata: MOMMetadata;
  agenda: string[];
  discussionSections: DiscussionSection[];
  decisions: string[];
  actionItems: ActionItem[];
  openIssues: OpenIssue[];
  nextSteps: string[];
  moodOfClient: string[];
  outOfScopeDiscussions: string[];
  notes: string[];
}

// =====================================================
// MoM PARSER
// =====================================================

const parseMOMContent = (content: string): ParsedMOM => {
  const lines = content.split("\n");
  const result: ParsedMOM = {
    metadata: {},
    agenda: [],
    discussionSections: [],
    decisions: [],
    actionItems: [],
    openIssues: [],
    nextSteps: [],
    moodOfClient: [],
    outOfScopeDiscussions: [],
    notes: [],
  };

  let currentSection: string | null = null;
  let currentDiscussion: DiscussionSection | null = null;
  let inMetadataTable = false;
  let inActionTable = false;
  let inIssuesTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("MOM —") && !result.metadata.headerLine) {
      result.metadata.headerLine = trimmed.replace(/^MOM\s+—\s*/, "");
      const parts = result.metadata.headerLine.split("|").map(s => s.trim());
      if (parts.length >= 2) {
        result.metadata.meetingType = parts[0];
        result.metadata.date = parts[1];
        result.metadata.companyName = parts[2] || "";
      }
      continue;
    }

    if (/^#\s*MINUTES\s+OF\s+MEETING/i.test(trimmed)) {
      result.metadata.meetingTitle = trimmed.replace(/^#\s*/, "").replace(/\s*\|.*$/, "");
      continue;
    }

    if (/^###\s/.test(trimmed)) {
      result.metadata.subtitle = trimmed.replace(/^###\s*/, "");
      const subParts = result.metadata.subtitle.split("|").map(s => s.trim());
      if (subParts.length >= 1 && !result.metadata.date) {
        result.metadata.date = subParts[0];
      }
      if (subParts.length >= 2) {
        result.metadata.companyName = result.metadata.companyName || subParts[1];
      }
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.includes("Field")) {
      inMetadataTable = true;
      continue;
    }

    if (inMetadataTable) {
      if (!trimmed.includes("|")) {
        inMetadataTable = false;
        continue;
      }
      if (trimmed.includes("---")) continue;
      const cells = trimmed.split("|").map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        const field = cells[0].toLowerCase().replace(/\s+/g, "").replace("/", "");
        const value = cells[1].trim();
        switch (field) {
          case "date":
            // Always use the metadata table value (it has the full date with time)
            result.metadata.date = value;
            break;
          case "meetingtype":
            result.metadata.meetingType = result.metadata.meetingType || value;
            break;
          case "platform":
            result.metadata.platform = value;
            break;
          case "projectmeetingtype":
          case "project/account":
          case "projectoraccount":
          case "project":
            result.metadata.projectOrAccount = value;
            break;
          case "facilitator":
            result.metadata.facilitator = value;
            break;
          case "participants":
            result.metadata.participants = value;
            break;
          case "topicscovered":
            result.metadata.topicsCovered = value;
            break;
          case "duration":
            result.metadata.duration = value;
            break;
        }
      }
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      currentSection = trimmed.replace(/^##\s+/, "").toLowerCase();
      inActionTable = false;
      inIssuesTable = false;

      if (currentSection.includes("agenda")) currentSection = "agenda";
      else if (currentSection.includes("decision")) currentSection = "decisions";
      else if (currentSection.includes("action")) currentSection = "actions";
      else if (currentSection.includes("open issue")) currentSection = "issues";
      else if (currentSection.includes("next step")) currentSection = "nextsteps";
      else if (currentSection.includes("mood") && currentSection.includes("client")) currentSection = "moodofclient";
      else if (currentSection.includes("out of scope") || currentSection.includes("out-of-scope")) currentSection = "outofscope";
      else if (currentSection.includes("discussion summary")) currentSection = "discussion";

      continue;
    }

    const subsectionMatch = trimmed.match(/^###\s+(\d+\.\d+)\s+(.+)$/);
    if (subsectionMatch && currentSection === "discussion") {
      if (currentDiscussion) {
        result.discussionSections.push(currentDiscussion);
      }
      currentDiscussion = {
        number: subsectionMatch[1],
        title: subsectionMatch[2],
        points: []
      };
      continue;
    }

    if (currentSection === "actions" && trimmed.includes("|") && trimmed.includes("Action")) {
      inActionTable = true;
      continue;
    }

    if (inActionTable && trimmed.includes("|")) {
      if (trimmed.includes("---")) continue;
      const cells = trimmed.split("|").map(c => c.trim()).filter(c => c);
      if (cells.length >= 5 && cells[0].match(/^\d+$/)) {
        result.actionItems.push({
          id: parseInt(cells[0]),
          action: cells[1],
          owner: cells[2],
          priority: cells[3] as any,
          status: cells[4] as any
        });
      }
      continue;
    }

    if (currentSection === "issues" && trimmed.includes("|") && (trimmed.includes("Issue") || trimmed.includes("Open"))) {
      inIssuesTable = true;
      continue;
    }

    if (inIssuesTable && trimmed.includes("|")) {
      if (trimmed.includes("---")) continue;
      const cells = trimmed.split("|").map(c => c.trim()).filter(c => c);
      if (cells.length >= 3 && cells[0].match(/^\d+$/)) {
        result.openIssues.push({
          id: parseInt(cells[0]),
          issue: cells[1],
          context: cells[2]
        });
      }
      continue;
    }

    if (trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*")) {
      const content = trimmed.replace(/^[-•*]\s*/, "");

      // Check for Note or End of Minutes BEFORE adding to any section
      if (/^note:/i.test(content) || /^end of/i.test(content)) {
        result.notes.push(content);
        continue;
      }

      if (currentSection === "agenda") {
        result.agenda.push(content);
      } else if (currentSection === "decisions") {
        result.decisions.push(content);
      } else if (currentSection === "nextsteps") {
        result.nextSteps.push(content);
      } else if (currentSection === "moodofclient") {
        result.moodOfClient.push(content);
      } else if (currentSection === "outofscope") {
        result.outOfScopeDiscussions.push(content);
      } else if (currentSection === "discussion" && currentDiscussion) {
        if (currentDiscussion.points.length === 0 && !content.includes("**")) {
          currentDiscussion.summary = content;
        } else {
          currentDiscussion.points.push(content);
        }
      }
      continue;
    }

    if (trimmed.startsWith("*Note:") || trimmed.startsWith("*End of")) {
      result.notes.push(trimmed.replace(/^\*/, "").trim());
    }

    if (currentSection === "discussion" && currentDiscussion && trimmed && !trimmed.startsWith("|")) {
      if (currentDiscussion.points.length === 0 && !currentDiscussion.summary) {
        currentDiscussion.summary = trimmed;
      } else if (trimmed.length > 10) {
        currentDiscussion.points.push(trimmed);
      }
    }
  }

  if (currentDiscussion) {
    result.discussionSections.push(currentDiscussion);
  }

  return result;
};

export function MOMViewer({ meeting, onRegenerate, regenerating }: MOMViewerProps) {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [activeTab, setActiveTab] = useState<"web" | "pdf">("web");
  const webContentRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);

  const parsed = meeting.mom ? parseMOMContent(meeting.mom) : null;

  const handleDownloadPDF = async () => {
    if (!pdfContentRef.current) return;
    setIsGeneratingPDF(true);
    try {
      const element = pdfContentRef.current;

      // Configure html2pdf with optimized settings to reduce gaps
      const opt = {
        margin: [8, 10, 8, 10], // Reduced margins [top, left, bottom, right] in mm
        filename: `${meeting.context || "Meeting"}-${formatIST(meeting.date_time, "filename")}.pdf`,
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: {
          scale: 2, // Reduced from 2.5 to minimize spacing
          useCORS: true,
          letterRendering: true,
          logging: false,
          // Improve text rendering
          scrollY: 0,
          scrollX: 0,
          windowHeight: element.scrollHeight,
          windowWidth: element.scrollWidth,
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait"
        },
        pagebreak: {
          mode: ["avoid-all", "css", "legacy"],
          before: ".page-break-before",
          after: ".page-break-after",
          avoid: ".no-break"
        },
      };

      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error("PDF generation error:", error);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  if (!meeting.mom || !parsed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-teal-100 rounded-full blur-3xl opacity-40"></div>
          <FileText className="relative w-16 h-16 text-gray-300" strokeWidth={1} />
        </div>
        <p className="text-gray-500 text-sm mb-6 font-medium">No Minutes of Meeting generated yet.</p>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="flex items-center gap-2 px-6 py-3 bg-teal-700 text-white rounded-xl text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 shadow-lg transition-all"
          >
            <Loader2 className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            Generate Minutes
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Header Action Bar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Minutes of Meeting</h1>
          <p className="text-gray-500 text-sm mt-0.5">{formatIST(meeting.date_time, "longDate")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("web")}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "web"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Web View
          </button>
          <button
            onClick={() => setActiveTab("pdf")}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "pdf"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            PDF Preview
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
            className="flex items-center gap-2 px-4 py-2 bg-[#0E6655] text-white rounded-md text-sm font-medium hover:bg-[#0b5245] disabled:opacity-50 transition-colors"
          >
            {isGeneratingPDF ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
            ) : (
              <><Download className="h-4 w-4" /> Download PDF</>
            )}
          </button>
        </div>
      </div>

      {/* WEB VIEW */}
      {activeTab === "web" && (
        <div ref={webContentRef} className="animate-in fade-in duration-300 mb-20 px-6 max-w-[1050px] mx-auto">
          {/* Header Title Section */}
          <MoMHeader metadata={parsed.metadata} title={meeting.context} />

          {/* Metadata Grid */}
          <MetadataGrid metadata={parsed.metadata} />

          {/* 1. AGENDA */}
          {parsed.agenda.length > 0 && <AgendaSection agenda={parsed.agenda} />}

          {/* 2. DISCUSSION SUMMARY */}
          {parsed.discussionSections.length > 0 && <DiscussionSection discussions={parsed.discussionSections} />}

          {/* 3. DECISIONS MADE */}
          {parsed.decisions.length > 0 && <DecisionsSection decisions={parsed.decisions} />}

          {/* 4. ACTION ITEMS */}
          {parsed.actionItems.length > 0 && <ActionItemsTable actionItems={parsed.actionItems} />}

          {/* 5. OPEN ISSUES */}
          {parsed.openIssues.length > 0 && <OpenIssuesTable openIssues={parsed.openIssues} />}

          {/* 6. NEXT STEPS */}
          {parsed.nextSteps.length > 0 && <NextStepsSection nextSteps={parsed.nextSteps} />}

          {/* 7. MOOD OF THE CLIENT/STAKEHOLDER */}
          {parsed.moodOfClient.length > 0 && <MoodOfClientSection moodOfClient={parsed.moodOfClient} />}

          {/* 8. OUT OF SCOPE DISCUSSION */}
          {parsed.outOfScopeDiscussions.length > 0 && <OutOfScopeSection outOfScopeDiscussions={parsed.outOfScopeDiscussions} />}

          {/* Closing Section (Note + End of Minutes) */}
          <ClosingSection notes={parsed.notes} metadata={parsed.metadata} />

          {/* Regenerate Button */}
          {onRegenerate && (
            <div className="mt-4">
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
              >
                {regenerating ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Regenerating...
                  </span>
                ) : (
                  "Regenerate Minutes"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* PDF VIEW - Optimized for proper PDF generation */}
      {activeTab === "pdf" && (
        <div className="flex justify-center">
          <div
            ref={pdfContentRef}
            className="bg-white shadow-2xl"
            style={{
              maxWidth: "210mm",
              padding: "10mm",
              fontFamily: "'Times New Roman', Times, serif",
              lineHeight: "1.3", // Reduced line-height
              fontSize: "11pt"
            }}
          >
            {/* PDF Header */}
            <div className="text-center mb-4 border-b-2 border-[#0E6655] pb-3" style={{ pageBreakInside: "avoid" }}>
              {/* Meeting | Date | Smart MoM */}
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1" style={{ marginBottom: "4px" }}>
                Meeting | {parsed.metadata.date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} | Smart MoM
              </p>
              {/* MINUTES OF MEETING */}
              <h1 className="text-xl font-bold text-gray-900 uppercase tracking-wide" style={{ margin: "4px 0" }}>
                MINUTES OF MEETING
              </h1>
              {/* Title/Context in uppercase */}
              {meeting.context && (
                <p className="text-base font-semibold text-gray-900 uppercase tracking-wide" style={{ margin: "4px 0 0 0" }}>
                  {meeting.context.toUpperCase()}
                </p>
              )}
            </div>

            {/* PDF Metadata Table */}
            <table className="w-full mb-4 text-sm" style={{ borderCollapse: "collapse", marginBottom: "16px" }}>
              <tbody>
                {parsed.metadata.date && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ width: "30%", padding: "4px 0" }}>Date & Time</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{parsed.metadata.date}</td>
                  </tr>
                )}
                {(parsed.metadata.projectOrAccount || parsed.metadata.meetingType) && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ padding: "4px 0" }}>Project / Meeting Type</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{parsed.metadata.projectOrAccount || parsed.metadata.meetingType}</td>
                  </tr>
                )}
                {parsed.metadata.platform && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ padding: "4px 0" }}>Platform</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{parsed.metadata.platform}</td>
                  </tr>
                )}
                {parsed.metadata.facilitator && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ padding: "4px 0" }}>Facilitator</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{parsed.metadata.facilitator}</td>
                  </tr>
                )}
                {parsed.metadata.participants && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ padding: "4px 0" }}>Participants</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{capitalizeParticipantNames(parsed.metadata.participants)}</td>
                  </tr>
                )}
                {parsed.metadata.duration && (
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td className="py-1 font-semibold text-gray-900" style={{ padding: "4px 0" }}>Duration</td>
                    <td className="py-1 text-gray-700" style={{ padding: "4px 0" }}>{parsed.metadata.duration}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* 1. AGENDA */}
            {parsed.agenda.filter(item => {
              const cleaned = item.replace(/\*\*/g, "").trim();
              return cleaned.length > 3 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned) && !/^to be announced$/i.test(cleaned);
            }).length > 0 && (
              <div className="mb-3 no-break" style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  1. Agenda
                </h2>
                <div style={{ paddingLeft: "20px" }}>
                  {parsed.agenda
                    .filter(item => {
                      const cleaned = item.replace(/\*\*/g, "").trim();
                      return cleaned.length > 3 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned) && !/^to be announced$/i.test(cleaned);
                    })
                    .map((item, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ minWidth: "20px", fontWeight: "normal" }}>{idx + 1}.</span>
                      <span>{item.replace(/\*\*/g, "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. DISCUSSION SUMMARY */}
            {parsed.discussionSections.length > 0 && (
              <div className="mb-3" style={{ marginBottom: "12px" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  2. Discussion Summary
                </h2>
                {parsed.discussionSections.map((section, idx) => (
                  <div key={idx} className="no-break" style={{ marginBottom: idx < parsed.discussionSections.length - 1 ? "10px" : "0", pageBreakInside: "avoid" }}>
                    <h3 className="text-sm font-semibold text-gray-900" style={{ margin: "6px 0 4px 0" }}>
                      {section.number} {section.title}
                    </h3>
                    {section.summary && (
                      <p className="text-gray-600 italic text-sm" style={{ margin: "4px 0" }}>{section.summary.replace(/\*\*/g, "")}</p>
                    )}
                    {section.points.length > 0 && (
                      <div className="text-sm" style={{ marginTop: "4px" }}>
                        {section.points.map((point, ptIdx) => (
                          <div key={ptIdx} style={{ display: "flex", alignItems: "baseline", marginBottom: ptIdx < section.points.length - 1 ? "3px" : "0", paddingLeft: "20px" }}>
                            <span style={{ marginRight: "6px" }}>•</span>
                            <span>{point.replace(/\*\*/g, "")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 3. DECISIONS MADE */}
            {parsed.decisions.filter(d => {
              const cleaned = d.replace(/\*\*/g, "").trim();
              return cleaned.length > 5 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned);
            }).length > 0 && (
              <div className="mb-3 no-break" style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  3. Decisions Made
                </h2>
                <div className="text-sm" style={{ paddingLeft: "20px" }}>
                  {parsed.decisions
                    .filter(d => {
                      const cleaned = d.replace(/\*\*/g, "").trim();
                      return cleaned.length > 5 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned);
                    })
                    .map((decision, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ marginRight: "6px" }}>•</span>
                      <span>{decision.replace(/\*\*/g, "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. ACTION ITEMS */}
            {parsed.actionItems.length > 0 && (
              <div className="mb-3" style={{ marginBottom: "12px" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  4. Action Items
                </h2>
                <table className="w-full text-xs" style={{ borderCollapse: "collapse", border: "1px solid #e5e7eb", fontSize: "10px" }}>
                  <thead>
                    <tr className="bg-[#0E6655] text-white">
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>#</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Action Item</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Owner</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Priority</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.actionItems.map((item) => (
                      <tr key={item.id} className="no-break" style={{ pageBreakInside: "avoid" }}>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{item.id}</td>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{item.action}</td>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{item.owner}</td>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{item.priority}</td>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 5. OPEN ISSUES */}
            {parsed.openIssues.length > 0 && (
              <div className="mb-3" style={{ marginBottom: "12px" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  5. Open Issues & Unresolved Items
                </h2>
                <table className="w-full text-xs" style={{ borderCollapse: "collapse", border: "1px solid #e5e7eb", fontSize: "10px" }}>
                  <thead>
                    <tr className="bg-[#0E6655] text-white">
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>#</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Open Issue</th>
                      <th className="border border-gray-300 px-2 py-1 text-left" style={{ padding: "4px 6px" }}>Context & Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.openIssues.map((issue) => (
                      <tr key={issue.id} className="no-break" style={{ pageBreakInside: "avoid" }}>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{issue.id}</td>
                        <td className="border border-gray-300 px-2 py-1 font-medium" style={{ padding: "4px 6px" }}>{issue.issue}</td>
                        <td className="border border-gray-300 px-2 py-1" style={{ padding: "4px 6px" }}>{issue.context}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 6. NEXT STEPS */}
            {parsed.nextSteps.filter(s => {
              const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
              return cleaned.length > 5
                && !/^note:/i.test(s)
                && !/^end of/i.test(s)
                && !/^none$/i.test(cleaned)
                && !/^n\/a$/i.test(cleaned)
                && !/^to be determined$/i.test(cleaned)
                && !/^tbd$/i.test(cleaned);
            }).length > 0 && (
              <div className="mb-3 no-break" style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  6. Next Steps
                </h2>
                <div className="text-sm" style={{ paddingLeft: "20px" }}>
                  {parsed.nextSteps
                    .filter(s => {
                      const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
                      return cleaned.length > 5
                        && !/^note:/i.test(s)
                        && !/^end of/i.test(s)
                        && !/^none$/i.test(cleaned)
                        && !/^n\/a$/i.test(cleaned)
                        && !/^to be determined$/i.test(cleaned)
                        && !/^tbd$/i.test(cleaned);
                    })
                    .map((step, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ minWidth: "20px", fontWeight: "normal" }}>{idx + 1}.</span>
                      <span>{step.replace(/\*\*/g, "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. MOOD OF THE CLIENT/STAKEHOLDER */}
            {parsed.moodOfClient.filter(s => {
              const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
              return cleaned.length > 5
                && !/^none$/i.test(cleaned)
                && !/^n\/a$/i.test(cleaned)
                && !/^not mentioned$/i.test(cleaned)
                && !/^to be determined$/i.test(cleaned);
            }).length > 0 && (
              <div className="mb-3 no-break" style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  7. Mood of the Client/Stakeholder
                </h2>
                <div className="text-sm" style={{ paddingLeft: "20px" }}>
                  {parsed.moodOfClient
                    .filter(s => {
                      const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
                      return cleaned.length > 5
                        && !/^none$/i.test(cleaned)
                        && !/^n\/a$/i.test(cleaned)
                        && !/^not mentioned$/i.test(cleaned)
                        && !/^to be determined$/i.test(cleaned);
                    })
                    .map((item, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "baseline", marginBottom: "4px" }}>
                        <span style={{ marginRight: "6px" }}>•</span>
                        <span>{item.replace(/\*\*/g, "")}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* 8. OUT OF SCOPE DISCUSSION */}
            {parsed.outOfScopeDiscussions.filter(s => {
              const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
              return cleaned.length > 5
                && !/^no out-of-scope discussions identified$/i.test(cleaned)
                && !/^none$/i.test(cleaned)
                && !/^n\/a$/i.test(cleaned)
                && !/^not applicable$/i.test(cleaned);
            }).length > 0 && (
              <div className="mb-3 no-break" style={{ marginBottom: "12px", pageBreakInside: "avoid" }}>
                <h2 className="text-base font-bold text-gray-900 uppercase border-b-2 border-[#0E6655] pb-1 mb-2" style={{ margin: "8px 0 8px 0" }}>
                  8. Out of Scope Discussion
                </h2>
                <div className="text-sm" style={{ paddingLeft: "20px" }}>
                  {parsed.outOfScopeDiscussions
                    .filter(s => {
                      const cleaned = s.replace(/\*\*/g, "").trim().toLowerCase();
                      return cleaned.length > 5
                        && !/^no out-of-scope discussions identified$/i.test(cleaned)
                        && !/^none$/i.test(cleaned)
                        && !/^n\/a$/i.test(cleaned)
                        && !/^not applicable$/i.test(cleaned);
                    })
                    .map((item, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "baseline", marginBottom: "4px" }}>
                        <span style={{ marginRight: "6px" }}>•</span>
                        <span>{item.replace(/\*\*/g, "")}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Closing Section (Note + End of Minutes) */}
            <div className="mt-4 pt-3 border-t border-gray-300" style={{ marginTop: "16px", paddingTop: "12px" }}>
              {parsed.notes.filter(n => !/^end of/i.test(n)).map((note, idx) => (
                <p key={idx} className="text-xs text-gray-600 mb-2" style={{ margin: "0 0 8px 0" }}>
                  <span className="font-semibold">Note: </span>{note.replace(/^Note:\s*/i, "").trim()}
                </p>
              ))}
              <p className="text-xs text-gray-500 uppercase tracking-wider text-center font-semibold" style={{ margin: "8px 0 0 0" }}>
                End of Minutes | {parsed.metadata.date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} | Smart MoM | Confidential
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
