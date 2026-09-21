import React from "react";
import { CheckCircle2 } from "lucide-react";
import type { DiscussionSection, ActionItem, OpenIssue, ParsedMOM } from "./MOMViewer";

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

// Radio button checked icon (Material Symbols style)
const RadioButtonCheckedIcon = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    <circle cx="12" cy="12" r="5"/>
  </svg>
);

// =====================================================
// MoM Header Section
// =====================================================

interface MoMHeaderProps {
  metadata: ParsedMOM["metadata"];
  title?: string;
}

export function MoMHeader({ metadata, title }: MoMHeaderProps) {
  return (
    <section className="mb-12 text-center md:text-left">
      <div className="inline-block bg-primary text-white text-[10px] font-bold tracking-[0.2em] px-3 py-1 rounded-sm mb-4 uppercase">
        Official Transcript
      </div>
      <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-primary mb-2 font-headline">
        MINUTES OF MEETING
      </h1>
      {title && (
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-primary mb-2 font-headline uppercase">
          {title}
        </h2>
      )}
      {metadata.date && (
        <p className="text-slate-500 font-medium tracking-wide">
          Ref ID: MOM-{metadata.date}
        </p>
      )}
    </section>
  );
}

// =====================================================
// Metadata Grid Section
// =====================================================

interface MetadataGridProps {
  metadata: ParsedMOM["metadata"];
}

export function MetadataGrid({ metadata }: MetadataGridProps) {
  return (
    <section className="grid md:grid-cols-2 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden mb-16 shadow-sm">
      {metadata.date && (
        <div className="bg-surface-container-lowest p-6 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date & Time</span>
          <p className="text-on-surface font-semibold">{metadata.date}</p>
        </div>
      )}
      {metadata.platform && (
        <div className="bg-surface-container-lowest p-6 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</span>
          <p className="text-on-surface font-semibold">{metadata.platform}</p>
        </div>
      )}
      {metadata.facilitator && (
        <div className="bg-surface-container-lowest p-6 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facilitator</span>
          <p className="text-on-surface font-semibold">{metadata.facilitator}</p>
        </div>
      )}
      {metadata.participants && (
        <div className="bg-surface-container-lowest p-6 flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Participants</span>
          <p className="text-on-surface font-semibold">{capitalizeParticipantNames(metadata.participants)}</p>
        </div>
      )}
      {(metadata.projectOrAccount || metadata.meetingType) && (
        <div className="bg-surface-container-lowest p-6 flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project / Meeting Type</span>
          <p className="text-on-surface font-medium leading-relaxed">
            {metadata.projectOrAccount || metadata.meetingType || "General"}
          </p>
        </div>
      )}
    </section>
  );
}

// =====================================================
// Agenda Section
// =====================================================

interface AgendaSectionProps {
  agenda: string[];
}

export function AgendaSection({ agenda }: AgendaSectionProps) {
  // Filter out empty or placeholder agenda items
  const validAgenda = agenda.filter(item => {
    const cleaned = item.replace(/\*\*/g, "").trim();
    return cleaned.length > 3 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned) && !/^to be announced$/i.test(cleaned);
  });

  // Don't render section if no valid agenda items
  if (validAgenda.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">1. Agenda</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="bg-surface-container-low rounded-xl p-8">
        <ul className="space-y-4">
          {validAgenda.map((item, idx) => (
            <li key={idx} className="flex items-start gap-4">
              <span className="w-6 h-6 flex items-center justify-center bg-primary text-white text-[10px] font-bold rounded-full shrink-0">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <p className="text-on-surface font-medium">{item.replace(/^\*\*/, "").replace(/\*\*$/, "")}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// =====================================================
// Discussion Section
// =====================================================

interface DiscussionSectionProps {
  discussions: DiscussionSection[];
}

export function DiscussionSection({ discussions }: DiscussionSectionProps) {
  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">2. Discussion Summary</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="space-y-8 pl-4">
        {discussions.map((section, idx) => (
          <div key={idx} className={`border-l-4 ${idx === 0 ? "border-primary-container" : "border-slate-300"} pl-6`}>
            <h3 className="text-lg font-bold text-primary mb-2 font-headline">
              {section.title}
            </h3>
            {section.summary && (
              <p className="text-slate-600 leading-relaxed mb-4">{section.summary.replace(/\*\*/g, "")}</p>
            )}
            {section.points.length > 0 && (
              <ul className="list-disc list-inside space-y-2 text-slate-500 text-sm ml-4">
                {section.points.map((point, ptIdx) => (
                  <li key={ptIdx}>{point.replace(/\*\*/g, "")}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// =====================================================
// Decisions Section
// =====================================================

interface DecisionsSectionProps {
  decisions: string[];
}

// Extract title and description from decision text
function parseDecision(decision: string): { title: string; description: string } {
  const cleaned = decision.replace(/\*\*/g, "").trim();
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex > 0 && colonIndex < 50) {
    return {
      title: cleaned.substring(0, colonIndex).trim(),
      description: cleaned.substring(colonIndex + 1).trim(),
    };
  }
  // Fallback: use first few words as title
  const words = cleaned.split(" ");
  const titleWords = words.slice(0, 2).join(" ");
  return {
    title: titleWords,
    description: cleaned,
  };
}

export function DecisionsSection({ decisions }: DecisionsSectionProps) {
  // Filter out empty or placeholder decisions
  const validDecisions = decisions.filter(d => {
    const cleaned = d.replace(/\*\*/g, "").trim();
    return cleaned.length > 5 && !/^none$/i.test(cleaned) && !/^n\/a$/i.test(cleaned);
  });

  // Don't render section if no valid decisions
  if (validDecisions.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">3. Decisions Made</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
        <ul className="space-y-6">
          {validDecisions.map((decision, idx) => {
            const { title, description } = parseDecision(decision);
            return (
              <li key={idx} className="flex items-start gap-4">
                <span className="material-symbols-outlined text-primary mt-1 shrink-0">radio_button_checked</span>
                <p className="text-on-surface leading-relaxed">
                  <span className="font-bold text-primary uppercase tracking-tight">{title}:</span>
                  {" "}{description}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// =====================================================
// Action Items Table
// =====================================================

interface ActionItemsTableProps {
  actionItems: ActionItem[];
}

const priorityColors: Record<string, string> = {
  Immediate: "bg-error/10 text-error",
  High: "bg-error/10 text-error",
  Medium: "bg-orange-500/10 text-orange-600",
  Low: "bg-green-500/10 text-green-600",
  Med: "bg-orange-500/10 text-orange-600",
};

const statusColors: Record<string, string> = {
  Open: "bg-blue-500/10 text-blue-600",
  "In Progress": "bg-yellow-500/10 text-yellow-600",
  "In-Progress": "bg-yellow-500/10 text-yellow-600",
  Closed: "bg-slate-500/10 text-slate-600",
  Completed: "bg-slate-500/10 text-slate-600",
  TBD: "bg-purple-500/10 text-purple-600",
};

export function ActionItemsTable({ actionItems }: ActionItemsTableProps) {
  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">4. Action Items</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="overflow-x-auto bg-surface-container-lowest rounded-xl border border-slate-100 shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Task</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Assigned To</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Due Date</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Priority</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {actionItems.map((item, idx) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-sm font-semibold text-primary">{item.action}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{item.owner}</td>
                <td className="px-6 py-4 text-sm text-slate-500">-</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${priorityColors[item.priority] || priorityColors.Medium}`}>
                    {item.priority}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${statusColors[item.status] || statusColors.Open}`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =====================================================
// Open Issues Table
// =====================================================

interface OpenIssuesTableProps {
  openIssues: OpenIssue[];
}

export function OpenIssuesTable({ openIssues }: OpenIssuesTableProps) {
  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">5. Open Issues</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="overflow-x-auto bg-surface-container-lowest rounded-xl border border-slate-100 shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Issue</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Description</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Potential Impact</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {openIssues.map((issue) => (
              <tr key={issue.id}>
                <td className="px-6 py-4 text-sm font-semibold text-primary">{issue.issue}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{issue.context}</td>
                <td className="px-6 py-4 text-sm text-orange-600 font-medium">Moderate: Technical Debt</td>
                <td className="px-6 py-4">
                  <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">
                    Under Review
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// =====================================================
// Next Steps Section
// =====================================================

interface NextStepsSectionProps {
  nextSteps: string[];
}

export function NextStepsSection({ nextSteps }: NextStepsSectionProps) {
  // Filter out empty, Note, End of Minutes, and placeholder next steps
  const validNextSteps = nextSteps.filter(step => {
    const cleaned = step.replace(/\*\*/g, "").trim().toLowerCase();
    return cleaned.length > 5
      && !/^note:/i.test(step)
      && !/^end of/i.test(step)
      && !/^none$/i.test(cleaned)
      && !/^n\/a$/i.test(cleaned)
      && !/^to be determined$/i.test(cleaned)
      && !/^tbd$/i.test(cleaned);
  });

  // Don't render section if no valid next steps
  if (validNextSteps.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">6. Next Steps</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="bg-primary text-white rounded-xl p-8 shadow-lg">
        <ul className="space-y-6">
          {validNextSteps.map((step, idx) => {
            const [title, ...descParts] = step.replace(/\*\*/g, "").split(":");
            const description = descParts.join(":").trim();
            return (
              <li key={idx} className="flex gap-4">
                <CheckCircle2 className="w-6 h-6 text-secondary-fixed flex-shrink-0" />
                <div>
                  <p className="font-bold mb-1">{title.trim()}</p>
                  {description && <p className="text-primary-fixed-dim text-sm">{description}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// =====================================================
// MOOD OF THE CLIENT/STAKEHOLDER Section
// =====================================================

interface MoodOfClientSectionProps {
  moodOfClient: string[];
}

export function MoodOfClientSection({ moodOfClient }: MoodOfClientSectionProps) {
  // Filter out empty or placeholder items
  const validMoodItems = moodOfClient.filter(item => {
    const cleaned = item.replace(/\*\*/g, "").trim();
    return cleaned.length > 5
      && !/^none$/i.test(cleaned)
      && !/^n\/a$/i.test(cleaned)
      && !/^to be determined$/i.test(cleaned)
      && !/^not mentioned$/i.test(cleaned);
  });

  // Don't render section if no valid mood items
  if (validMoodItems.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">7. Mood of the Client/Stakeholder</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="bg-surface-container-low rounded-xl p-8">
        <ul className="space-y-4">
          {validMoodItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary mt-0.5 shrink-0">radio_button_checked</span>
              <p className="text-on-surface font-medium leading-relaxed">{item.replace(/\*\*/g, "")}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// =====================================================
// Out of Scope Discussion Section
// =====================================================

interface OutOfScopeSectionProps {
  outOfScopeDiscussions: string[];
}

export function OutOfScopeSection({ outOfScopeDiscussions }: OutOfScopeSectionProps) {
  // Filter out empty or placeholder items - but keep the section if there are valid items
  // even if one bullet says "no out-of-scope discussions identified"
  const validItems = outOfScopeDiscussions.filter(item => {
    const cleaned = item.replace(/\*\*/g, "").trim().toLowerCase();
    // Filter out only the placeholder/disclaimer text, keep actual content
    return cleaned.length > 5
      && !/^no out-of-scope discussions identified$/i.test(cleaned)
      && !/^none$/i.test(cleaned)
      && !/^n\/a$/i.test(cleaned)
      && !/^not applicable$/i.test(cleaned);
  });

  // Don't render section if no valid items
  if (validItems.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-primary uppercase font-headline">8. Out of Scope Discussion</h2>
        <div className="flex-grow h-px bg-slate-200"></div>
      </div>
      <div className="bg-surface-container-low rounded-xl p-8">
        <ul className="space-y-4">
          {validItems.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary mt-0.5 shrink-0">radio_button_checked</span>
              <p className="text-on-surface font-medium leading-relaxed">{item.replace(/\*\*/g, "")}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// =====================================================
// Closing Section (Note + End of Minutes)
// =====================================================

interface ClosingSectionProps {
  notes: string[];
  metadata: ParsedMOM["metadata"];
}

export function ClosingSection({ notes, metadata }: ClosingSectionProps) {
  // Use the date string directly from metadata (preserves the full date + time)
  const displayDate = metadata.date || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Filter out "End of Minutes" lines from notes - they should only appear in the closing line
  const actualNotes = notes.filter(note => !/^end of/i.test(note));

  return (
    <section className="mt-16">
      <div className="bg-surface-container-lowest rounded-xl border border-slate-200 p-6">
        {/* Note paragraph - only show actual notes, not "End of Minutes" */}
        {actualNotes.length > 0 && (
          <p className="text-sm text-slate-600 mb-4 leading-relaxed">
            <span className="font-semibold text-slate-700">Note: </span>
            {actualNotes.map((note, idx) => (
              <span key={idx}>{note.replace(/^Note:\s*/i, "").trim()}</span>
            ))}
          </p>
        )}

        {/* End of Minutes closing line - always shown, separate from notes */}
        <div className="pt-4 border-t border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
            End of Minutes | {displayDate} | Smart MoM | Confidential
          </p>
        </div>
      </div>
    </section>
  );
}
