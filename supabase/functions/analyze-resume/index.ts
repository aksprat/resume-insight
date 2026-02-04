import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Must include ALL headers the browser sends (Supabase client adds x-supabase-client-*)
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { resumeText, fileName, fileType, fileSize } = await req.json();
    
    if (!resumeText || typeof resumeText !== "string" || resumeText.trim().length < 50) {
      console.error("Insufficient resume text. Length:", resumeText?.length || 0);
      return new Response(
        JSON.stringify({ 
          error: "Could not extract enough text from the resume. Please ensure the file contains readable text content."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("Resume text received (first 500 chars):", resumeText.substring(0, 500));

    // Trigger n8n webhook (server-to-server, no CORS issues)
    try {
      await fetch("https://hmitra.app.n8n.cloud/webhook-test/resume-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: resumeText,
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

IMPORTANT: Only return valid JSON, no additional text before or after the JSON object.`;

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
          { role: "user", content: `Please analyze this resume and generate interview questions:\n\n${resumeText}` },
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
