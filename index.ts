
import { corsHeaders } from '../_shared/cors.ts';

interface SkillAnalysisRequest {
  fullName: string;
  email: string;
  primarySkill: string;
  experience: string;
}

interface AnalysisResult {
  profileSummary: string;
  suggestedSkills: string[];
  confidence: number;
}

Deno.serve(async (req: Request) => {
  console.log(" Incoming request");
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const requestData: SkillAnalysisRequest = await req.json();
   

    const { fullName, email, primarySkill, experience } = requestData;
  // Validating required fields
    if (!fullName || !email || !primarySkill || !experience) {
    
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.log(" GEMINI_API_KEY missing");
      return new Response(
        JSON.stringify({
          error: 'Gemini API key not configured',
          message: 'Add GEMINI_API_KEY in Supabase project environment variables.'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log("📝 Building prompt");
    const promptText = `Analyze this professional profile and respond with JSON only:

Name: ${fullName}
Skill: ${primarySkill}
Experience: ${experience}

Return exactly this JSON structure:
{
  \"profileSummary\": \"2-sentence professional summary highlighting strengths\",
  \"suggestedSkills\": [\"Skill1\", \"Skill2\"],
  \"confidence\": 85
}`;

    //calling Gemini API
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: promptText }] }
          ]
        }),
      }
    );
    
  //handling Gemini Response
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.log(" Gemini API error:", errorText);
      return new Response(
        JSON.stringify({ error: 'Gemini API error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parsing Gemini JSON
    const geminiData = await geminiResponse.json();

    //extracting AI content
    // deno-lint-ignore prefer-const
    let aiContent: string | undefined = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("✔️ aiContent raw:", aiContent);
    if (!aiContent) {
   
      return new Response(
        JSON.stringify({ error: 'No response from Gemini API' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strip code fences if present
  
    let jsonText = aiContent.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    
    //Parsing aiContent as JSON
    let analysisResult: AnalysisResult;
    try {
      analysisResult = JSON.parse(jsonText);
   
    } catch (parseError) {
      console.error("Parse error:", parseError);
      let message = 'Unknown error';
      if (parseError instanceof Error) message = parseError.message;
      return new Response(
        JSON.stringify({ error: 'Invalid JSON from Gemini response', details: message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
    if (!supabaseUrl || !supabaseKey) {
      
      return new Response(
        JSON.stringify({ error: 'Supabase configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    //nserting into Supabase
    const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/skill_analyses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_name: fullName,
        user_email: email,
        primary_skill: primarySkill,
        experience_description: experience,
        ai_profile_summary: analysisResult.profileSummary,
        ai_suggested_skills: analysisResult.suggestedSkills,
        ai_confidence: analysisResult.confidence
      }),
    });
    

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      console.log("Supabase error:", errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to save analysis', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    //Reading savedAnalysis
    const savedAnalysis = await supabaseResponse.json();


    return new Response(
      JSON.stringify({
        id: savedAnalysis[0]?.id,
        profileSummary: analysisResult.profileSummary,
        suggestedSkills: analysisResult.suggestedSkills,
        confidence: analysisResult.confidence,
        success: true
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error("❌ Uncaught error:", error);
    let message = 'Unknown error';
    if (error instanceof Error) message = error.message;
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
