# Minimal Function Calling Patch for v35

## Answer to Your Question

**You MUST edit `processUserSpeech` function** - you cannot just add a file. Function calling requires:
1. Adding `tools` parameter to OpenAI API call
2. Checking for `tool_calls` in the response
3. Handling function calls and getting AI's response to the result

However, we can do it **minimally** by only adding the function calling logic without changing the conversation flow.

## What Needs to Change

### File: `index.js`
- **Function**: `processUserSpeech` (around line 350)
- **Change**: Add function calling support while keeping all existing conversation logic

### Minimal Changes Needed:

1. Import function handler (add at top):
```javascript
import { getFunctionDefinitions, handleFunctionCall } from './functionHandler.js';
```

2. In `processUserSpeech`, modify the OpenAI call to include tools:
```javascript
// Get AI response from OpenAI with function calling
let completion = await openai.chat.completions.create({
  model: session.agent.model_name || 'gpt-4o-mini',
  messages: [
    { role: 'system', content: session.systemPrompt },
    ...session.messages,
  ],
  temperature: session.agent.temperature || 0.7,
  max_tokens: session.agent.max_tokens || 250,
  tools: getFunctionDefinitions(),  // ADD THIS
  tool_choice: 'auto',              // ADD THIS
});
```

3. After getting completion, check for function calls (add before the final response):
```javascript
const message = completion.choices[0]?.message;

// Check if AI wants to call a function
if (message.tool_calls && message.tool_calls.length > 0) {
  console.log(`🔧 AI wants to call function: ${message.tool_calls[0].function.name}`);
  
  // Handle function calls
  for (const toolCall of message.tool_calls) {
    const functionResult = await handleFunctionCall(toolCall, session);
    
    // Add function call and result to conversation
    session.messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [toolCall]
    });
    
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(functionResult)
    });
    
    // Get AI's response to the function result
    completion = await openai.chat.completions.create({
      model: session.agent.model_name || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: session.systemPrompt },
        ...session.messages,
      ],
      temperature: session.agent.temperature || 0.7,
      max_tokens: session.agent.max_tokens || 250,
    });
  }
}

// Then continue with existing code:
const aiResponse = completion.choices[0]?.message?.content || 'I apologize, I did not understand that.';
```

## New File Needed

- `functionHandler.js` - Separate module for function definitions and handling

## Summary

**You must edit `processUserSpeech`** but you can do it minimally:
- Keep all existing conversation logic
- Only add function calling check after OpenAI response
- Use separate module for function handling

This preserves v35's working conversation flow while adding booking capability.


