import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import mammoth from "mammoth";

// Set up the worker for pdf.js v3
GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface Question {
  question: string;
  category: string;
  context?: string;
}

interface AnalysisResult {
  candidateName: string | null;
  questions: Question[];
}

// Extract text from PDF using pdf.js
async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  
  const textParts: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    textParts.push(pageText);
  }
  
  return textParts.join("\n\n");
}

// Extract text from DOCX using mammoth
async function extractTextFromDOCX(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// Extract text from files based on type
async function extractTextFromFile(file: File): Promise<string | null> {
  // For text files, read as text
  if (file.type === "text/plain" || file.name.endsWith(".txt")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }
  
  // For PDFs, use pdf.js for proper text extraction
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    try {
      const text = await extractTextFromPDF(file);
      console.log("PDF text extracted, length:", text.length);
      return text;
    } catch (error) {
      console.error("PDF extraction error:", error);
      throw new Error("Failed to extract text from PDF. Please ensure the PDF contains readable text.");
    }
  }
  
  // For DOCX files, use mammoth
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
    file.name.endsWith(".docx")
  ) {
    try {
      const text = await extractTextFromDOCX(file);
      console.log("DOCX text extracted, length:", text.length);
      return text;
    } catch (error) {
      console.error("DOCX extraction error:", error);
      throw new Error("Failed to extract text from DOCX. Please ensure the file is a valid Word document.");
    }
  }

  // For legacy DOC files (not supported by mammoth)
  if (file.type === "application/msword" || file.name.endsWith(".doc")) {
    throw new Error("Legacy .doc files are not supported. Please convert to .docx or PDF format.");
  }
  
  return null;
}

export function useResumeAnalysis() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeResume = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // Extract text from file (now handles PDFs properly with pdf.js)
      const resumeText = await extractTextFromFile(file);
      
      if (!resumeText || resumeText.trim().length < 50) {
        throw new Error("Could not extract enough text from the file. Please ensure your resume contains readable text.");
      }

      // Call the edge function with the extracted text
      const { data, error: fnError } = await supabase.functions.invoke("analyze-resume", {
        body: { 
          resumeText,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || "Failed to analyze resume");
      }

      if (data.error) {
        throw new Error(data.error);
      }

      // Validate response format - n8n might return different structures
      if (!data.questions || !Array.isArray(data.questions)) {
        console.error("Invalid n8n response format:", data);
        throw new Error(data.message || "The workflow did not return interview questions. Please check the n8n workflow configuration.");
      }

      setResult(data);
      toast({
        title: "Analysis Complete!",
        description: `Generated ${data.questions.length} interview questions`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze resume";
      setError(message);
      toast({
        title: "Analysis Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return {
    analyzeResume,
    isLoading,
    result,
    error,
    reset,
  };
}
