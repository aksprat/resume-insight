import { useState } from "react";
import { QuestionCard } from "./QuestionCard";
import { Copy, Download, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Question {
  question: string;
  category: string;
  context?: string;
}

interface QuestionsListProps {
  questions: Question[];
  candidateName?: string;
}

export function QuestionsList({ questions = [], candidateName }: QuestionsListProps) {
  const [filter, setFilter] = useState<string>("all");

  // Defensive check for undefined/null questions
  const safeQuestions = Array.isArray(questions) ? questions : [];
  
  const categories = ["all", ...new Set(safeQuestions.map(q => q.category.toLowerCase()))];
  
  const filteredQuestions = filter === "all" 
    ? safeQuestions 
    : safeQuestions.filter(q => q.category.toLowerCase() === filter);

  const handleCopyAll = async () => {
    const text = safeQuestions.map((q, i) => `${i + 1}. [${q.category}] ${q.question}`).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "All questions copied to clipboard",
    });
  };

  const handleExport = () => {
    const text = safeQuestions.map((q, i) => `${i + 1}. [${q.category}] ${q.question}`).join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-questions${candidateName ? `-${candidateName}` : ""}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Exported!",
      description: "Questions exported to file",
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-semibold text-foreground">
            Interview Questions
          </h2>
          {candidateName && (
            <p className="text-muted-foreground mt-1">
              Generated for <span className="text-foreground font-medium">{candidateName}</span>
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <Copy className="w-4 h-4" />
            Copy All
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg gradient-hero text-primary-foreground hover:opacity-90 transition-opacity shadow-glow"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setFilter(category)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap",
              filter === category
                ? "gradient-hero text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            )}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
            {category !== "all" && (
              <span className="ml-1.5 opacity-70">
                ({safeQuestions.filter(q => q.category.toLowerCase() === category).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Questions Grid */}
      <div className="grid gap-4">
        {filteredQuestions.map((q, index) => (
          <QuestionCard
            key={index}
            question={q.question}
            category={q.category}
            context={q.context}
            index={index}
          />
        ))}
      </div>

      {/* Summary */}
      <div className="text-center text-sm text-muted-foreground pt-4">
        Showing {filteredQuestions.length} of {safeQuestions.length} questions
      </div>
    </div>
  );
}
