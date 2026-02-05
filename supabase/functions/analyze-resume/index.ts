import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
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

    // Call n8n production webhook to generate questions
    const n8nResponse = await fetch("https://hmitra.app.n8n.cloud/webhook/resume-upload", {
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

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      console.error("n8n webhook error:", n8nResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to generate questions from workflow" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await n8nResponse.json();
    console.log("n8n response received:", JSON.stringify(result).substring(0, 500));

    // Return the n8n response directly (expecting { candidateName, questions } format)
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
