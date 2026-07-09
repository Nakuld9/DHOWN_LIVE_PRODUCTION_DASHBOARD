import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL,
});

export async function askGLM(prompt){

    const response = await client.chat.completions.create({

        model:"z-ai/glm-5.2",

        messages:[
            {
                role:"user",
                content:prompt
            }
        ]

    });

    return response.choices[0].message.content;

}
