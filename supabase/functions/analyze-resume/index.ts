import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Must include ALL headers the browser sends (Supabase client adds x-supabase-client-*)
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Enhanced PDF text extraction - handles text streams and various encodings
function extractTextFromPDFSimple(base64Data: string): string {
  try {
    const binaryString = atob(base64Data);
    const textChunks: string[] = [];
    
    // Method 1: Extract text between BT (begin text) and ET (end text) markers
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let match;
    while ((match = btEtRegex.exec(binaryString)) !== null) {
      const textBlock = match[1];
      // Extract text from Tj and TJ operators
      const tjMatches = textBlock.match(/\(([^)]*)\)\s*Tj/g) || [];
      const tJMatches = textBlock.match(/\[([^\]]*)\]\s*TJ/g) || [];
      
      for (const tj of tjMatches) {
        const text = tj.match(/\(([^)]*)\)/)?.[1] || "";
        if (text.length > 0) textChunks.push(text);
      }
      
      for (const tJ of tJMatches) {
        // TJ arrays contain strings in parentheses with kerning values
        const strings = tJ.match(/\(([^)]*)\)/g) || [];
        const combined = strings.map(s => s.slice(1, -1)).join("");
        if (combined.length > 0) textChunks.push(combined);
      }
    }
    
    // Method 2: Also look for text in stream objects (for compressed streams that were decoded)
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
    while ((match = streamRegex.exec(binaryString)) !== null) {
      const streamContent = match[1];
      // Extract any readable text sequences (4+ chars)
      const readableMatches = streamContent.match(/[A-Za-z][A-Za-z0-9\s.,@\-_'":;!?()]{3,}/g) || [];
      for (const readable of readableMatches) {
        if (readable.trim().length > 3 && !readable.match(/^(obj|endobj|stream|endstream|xref|trailer)$/i)) {
          textChunks.push(readable.trim());
        }
      }
    }
    
    // Method 3: Fallback - extract all printable ASCII sequences
    if (textChunks.length < 10) {
      let currentText = "";
      for (let i = 0; i < binaryString.length; i++) {
        const charCode = binaryString.charCodeAt(i);
        if (charCode >= 32 && charCode <= 126) {
          currentText += binaryString[i];
        } else if (charCode === 10 || charCode === 13) {
          if (currentText.trim().length > 4) {
            // Filter out PDF commands
            if (!currentText.match(/^[\d\s.]+$/) && 
                !currentText.match(/^\/[A-Z]/i) &&
                !currentText.startsWith("<<") &&
                !currentText.startsWith(">>")) {
              textChunks.push(currentText.trim());
            }
          }
          currentText = "";
        }
      }
      if (currentText.trim().length > 4) {
        textChunks.push(currentText.trim());
      }
    }
    
    // Deduplicate and join
    const uniqueChunks = [...new Set(textChunks)];
    const result = uniqueChunks
      .filter(chunk => chunk.length > 2)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    
    console.log("PDF extraction result length:", result.length, "chunks:", uniqueChunks.length);
    console.log("First 500 chars of extracted text:", result.substring(0, 500));
    
    return result;
  } catch (error) {
    console.error("PDF parsing error:", error);
    throw new Error("Failed to parse PDF file");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { resumeText, fileBase64, fileName, fileType, fileSize } = await req.json();
    
    // Get text either from direct text or by parsing PDF
    let textContent = resumeText;
    if (!textContent && fileBase64) {
      if (fileType === "application/pdf" || fileName?.endsWith(".pdf")) {
        textContent = extractTextFromPDFSimple(fileBase64);
      } else {
        // For other binary formats, try decoding as text
        try {
          textContent = atob(fileBase64);
        } catch {
          throw new Error("Unsupported file format");
        }
      }
    }
    
    if (!textContent || typeof textContent !== "string" || textContent.trim().length < 50) {
      console.error("Text extraction failed. Content length:", textContent?.length || 0);
      return new Response(
        JSON.stringify({ 
          error: "Could not extract enough text from the resume. Please ensure the file contains readable text content.",
          debug: { extractedLength: textContent?.length || 0 }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("Resume text to analyze (first 1000 chars):", textContent.substring(0, 1000));

    // Trigger n8n webhook (server-to-server, no CORS issues)
    try {
      await fetch("https://hmitra.app.n8n.cloud/webhook-test/resume-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: textContent,
          fileName: fileName || "unknown",
          fileType: fileType || "unknown",
          fileSize: fileSize || 0,
          timestamp: new Date().toISOString(),
        }),
      });
      console.log("n8n webhook triggered successfully");
    } catch (webhookError) {
      console.error("n8n webhook error (continuing anyway):", webhookError);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert interviewer and HR professional. Your task is to analyze a resume and generate insightful interview questions that will help assess whether the candidate truly possesses the skills and experience they claim.

Generate 10-15 interview questions based on the resume content. Each question should:
1. Be specific to the candidate's stated experience
2. Test depth of knowledge, not just surface-level recall
3. Include follow-up prompts to dig deeper

Categorize each question into one of these categories:
- Technical: Questions about specific technologies, tools, or technical skills
- Experience: Questions about past projects, roles, and achievements
- Behavioral: Questions about soft skills, teamwork, and problem-solving approach
- Projects: Deep-dive questions about specific projects mentioned
- Skills: Questions to verify claimed skills and competencies
- Education: Questions about academic background and certifications

Return your response as a JSON object with this structure:
{
  "candidateName": "extracted name or null",
  "questions": [
    {
      "question": "The interview question",
      "category": "Technical|Experience|Behavioral|Projects|Skills|Education",
      "context": "Brief note about why this question is relevant based on the resume"
    }
  ]
}

Only return valid JSON, no additional text.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Please analyze this resume and generate interview questions:\n\n${textContent}` },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI");
    }

    // Parse the JSON response
    let result;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/```\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("analyze-resume error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
