export const MODEL_MAPPING = {
    "gemini-3-pro-image-preview": "019aa208-5c19-7162-ae3b-0a9ddbb1e16a",
    "seedream-4-high-res-fal": "32974d8d-333c-4d2e-abf3-f258c0ac1310",
    "hunyuan-image-3.0": "7766a45c-1b6b-4fb8-9823-2557291e1ddd",
    "gemini-2.5-flash-image-preview": "0199ef2a-583f-7088-b704-b75fd169401d",
    "imagen-4.0-ultra-generate-preview-06-06": "f8aec69d-e077-4ed1-99be-d34f48559bbf",
    "imagen-4.0-generate-preview-06-06": "2ec9f1a6-126f-4c65-a102-15ac401dcea4",
    "wan2.5-t2i-preview": "019a5050-2875-78ed-ae3a-d9a51a438685",
    "gpt-image-1": "6e855f13-55d7-4127-8656-9168a9f4dcc0",
    "gpt-image-mini": "0199c238-f8ee-7f7d-afc1-7e28fcfd21cf",
    "mai-image-1": "1b407d5c-1806-477c-90a5-e5c5a114f3bc",
    "seedream-3": "d8771262-8248-4372-90d5-eb41910db034",
    "qwen-image-prompt-extend": "9fe82ee1-c84f-417f-b0e7-cab4ae4cf3f3",
    "flux-1-kontext-pro": "28a8f330-3554-448c-9f32-2c0a08ec6477",
    "imagen-3.0-generate-002": "51ad1d79-61e2-414c-99e3-faeb64bb6b1b",
    "ideogram-v3-quality": "73378be5-cdba-49e7-b3d0-027949871aa6",
    "photon": "e7c9fa2d-6f5d-40eb-8305-0980b11c7cab",
    "lucid-origin": "5a3b3520-c87d-481f-953c-1364687b6e8f",
    "recraft-v3": "b88d5814-1d20-49cc-9eb6-e362f5851661",
    "gemini-2.0-flash-preview-image-generation": "69bbf7d4-9f44-447e-a868-abc4f7a31810",
    "dall-e-3": "bb97bc68-131c-4ea4-a59e-03a6252de0d2",
    "flux-1-kontext-dev": "eb90ae46-a73a-4f27-be8b-40f090592c9a",
    "imagen-4.0-fast-generate-001": "f44fd4f8-af30-480f-8ce2-80b2bdfea55e",
    "hunyuan-image-2.1": "a9a26426-5377-4efa-bef9-de71e29ad943"
};

/**
 * 获取模型列表
 */
export function getModels() {
    return {
        object: "list",
        data: Object.keys(MODEL_MAPPING).map(id => ({
            id: id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "lmarena"
        }))
    };
}
