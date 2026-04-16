import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import type {
  ValidateLLMRequest,
  ValidateLLMResponse,
  LLMValidationResult,
  LLMProviderType,
} from '@/src/types/onboarding';

// ============================================================================
// Ollama URL Validation (SSRF protection)
// ============================================================================

/**
 * Custom URL schema for Ollama connections.
 *
 * Unlike the generic `safeUrlSchema` (which blocks all private ranges),
 * Ollama legitimately runs on localhost / private networks.  We therefore
 * only enforce:
 *   - HTTP(S) protocol
 *   - Block cloud metadata endpoints (169.254.169.254, metadata.google.internal)
 *
 * Localhost and RFC-1918 addresses are explicitly allowed.
 */
const ollamaUrlSchema = z.string().url().refine((url) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // Block cloud metadata endpoints that could leak credentials
    const blocked = ['169.254.169.254', 'metadata.google.internal'];
    if (blocked.includes(parsed.hostname)) return false;
    // Allow localhost and private ranges for Ollama
    return true;
  } catch { return false; }
}, { message: 'Invalid Ollama URL' });

// ============================================================================
// API Key Format Patterns
// ============================================================================

const API_KEY_PATTERNS: Record<LLMProviderType, RegExp | null> = {
  anthropic: /^sk-ant-[a-zA-Z0-9-_]{20,}$/,
  openai: /^sk-[a-zA-Z0-9]{20,}$/,
  google: /^AI[a-zA-Z0-9_-]{30,}$/,
  ollama: null, // No API key required
};

const API_KEY_HELP: Record<LLMProviderType, string> = {
  anthropic: 'Anthropic API keys start with "sk-ant-" and are at least 20 characters',
  openai: 'OpenAI API keys start with "sk-" and are at least 20 characters',
  google: 'Google AI API keys start with "AI" and are at least 30 characters',
  ollama: 'Ollama does not require an API key',
};

// ============================================================================
// Provider-Specific Validation
// ============================================================================

/**
 * Validate API key format before making network request.
 */
function validateKeyFormat(provider: LLMProviderType, apiKey?: string): LLMValidationResult {
  // Ollama doesn't need an API key
  if (provider === 'ollama') {
    return { valid: true };
  }

  // Check key is provided
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: `API key is required for ${provider}`,
      fieldErrors: { apiKey: 'API key is required' },
    };
  }

  // Check key format
  const pattern = API_KEY_PATTERNS[provider];
  if (pattern && !pattern.test(apiKey)) {
    return {
      valid: false,
      error: `Invalid API key format for ${provider}`,
      fieldErrors: { apiKey: API_KEY_HELP[provider] },
    };
  }

  return { valid: true };
}

/**
 * Validate Anthropic API key by making a test request.
 */
async function validateAnthropicKey(apiKey: string): Promise<LLMValidationResult> {
  const startTime = Date.now();

  try {
    // Make a minimal request to validate the key
    // Using messages API with minimal tokens to reduce cost
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2024-01-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        valid: true,
        latencyMs,
        availableModels: [
          'claude-3-5-sonnet-20241022',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307',
        ],
        providerInfo: {
          version: '2024-01-01',
        },
      };
    }

    // Handle specific error codes
    if (response.status === 401) {
      return {
        valid: false,
        error: 'Invalid API key. Please check your key and try again.',
        fieldErrors: { apiKey: 'API key is invalid or has been revoked' },
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        error: 'API key does not have permission for this operation.',
        fieldErrors: { apiKey: 'Insufficient permissions' },
      };
    }

    if (response.status === 429) {
      return {
        valid: false,
        error: 'Rate limit exceeded. Please wait and try again.',
      };
    }

    // Generic error
    const errorBody = await response.text();
    return {
      valid: false,
      error: `Anthropic API error: ${response.status}`,
      metadata: { statusCode: response.status, body: errorBody },
    };
  } catch (error) {
    console.error('[validate-llm] Anthropic connection error:', error);
    return {
      valid: false,
      error: 'Failed to connect to Anthropic API. Please check your network.',
    };
  }
}

/**
 * Validate OpenAI API key by making a test request.
 */
async function validateOpenAIKey(apiKey: string): Promise<LLMValidationResult> {
  const startTime = Date.now();

  try {
    // List models endpoint is a lightweight way to validate
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const models = data.data
        ?.filter((m: { id: string }) =>
          ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'].includes(m.id)
        )
        .map((m: { id: string }) => m.id) || ['gpt-4o', 'gpt-4-turbo'];

      return {
        valid: true,
        latencyMs,
        availableModels: models,
      };
    }

    if (response.status === 401) {
      return {
        valid: false,
        error: 'Invalid API key. Please check your key and try again.',
        fieldErrors: { apiKey: 'API key is invalid or has been revoked' },
      };
    }

    if (response.status === 429) {
      return {
        valid: false,
        error: 'Rate limit exceeded. Please wait and try again.',
      };
    }

    return {
      valid: false,
      error: `OpenAI API error: ${response.status}`,
    };
  } catch (error) {
    console.error('[validate-llm] OpenAI connection error:', error);
    return {
      valid: false,
      error: 'Failed to connect to OpenAI API. Please check your network.',
    };
  }
}

/**
 * Validate Google AI API key by making a test request.
 */
async function validateGoogleKey(apiKey: string): Promise<LLMValidationResult> {
  const startTime = Date.now();

  try {
    // List models endpoint
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
      { method: 'GET' }
    );

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const models = data.models
        ?.filter((m: { name: string }) =>
          m.name.includes('gemini')
        )
        .map((m: { name: string }) => m.name.replace('models/', ''))
        .slice(0, 5) || ['gemini-2.0-flash', 'gemini-1.5-pro'];

      return {
        valid: true,
        latencyMs,
        availableModels: models,
      };
    }

    if (response.status === 400 || response.status === 401) {
      return {
        valid: false,
        error: 'Invalid API key. Please check your key and try again.',
        fieldErrors: { apiKey: 'API key is invalid' },
      };
    }

    return {
      valid: false,
      error: `Google AI API error: ${response.status}`,
    };
  } catch (error) {
    console.error('[validate-llm] Google AI connection error:', error);
    return {
      valid: false,
      error: 'Failed to connect to Google AI API. Please check your network.',
    };
  }
}

/**
 * Validate Ollama connection by checking the base URL.
 */
async function validateOllamaConnection(baseUrl: string): Promise<LLMValidationResult> {
  const startTime = Date.now();

  // Default to localhost if not provided
  const url = baseUrl || 'http://localhost:11434';

  // Validate the URL to prevent SSRF — block cloud metadata endpoints
  // while still allowing localhost and private-network Ollama instances.
  const urlCheck = ollamaUrlSchema.safeParse(url);
  if (!urlCheck.success) {
    return {
      valid: false,
      error: 'Invalid URL: must be HTTP(S) and not point to cloud metadata endpoints',
    };
  }

  try {
    // Check Ollama is running by listing models
    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const models = data.models?.map((m: { name: string }) => m.name) || [];

      if (models.length === 0) {
        return {
          valid: true,
          latencyMs,
          availableModels: [],
          metadata: {
            warning: 'No models installed. Run "ollama pull llama3.2" to download a model.',
          },
        };
      }

      return {
        valid: true,
        latencyMs,
        availableModels: models,
      };
    }

    return {
      valid: false,
      error: `Could not connect to Ollama at ${url}`,
      fieldErrors: { baseUrl: 'Ollama is not running at this address' },
    };
  } catch (error) {
    console.error('[validate-llm] Ollama connection error:', error);
    return {
      valid: false,
      error: `Could not connect to Ollama. Make sure Ollama is running at ${url}`,
      fieldErrors: { baseUrl: 'Connection failed - is Ollama running?' },
    };
  }
}

// ============================================================================
// POST /api/onboarding/validate-llm
// ============================================================================

/**
 * POST /api/onboarding/validate-llm
 *
 * Validate LLM provider configuration.
 * Tests the API key or connection against the provider's API.
 *
 * Request body: ValidateLLMRequest
 * - provider: 'anthropic' | 'openai' | 'google' | 'ollama'
 * - apiKey: API key (not required for ollama)
 * - baseUrl: Custom endpoint URL (required for ollama)
 * - model: Optional model to test
 *
 * Response: ValidateLLMResponse
 * - result: LLMValidationResult with validation status and available models
 *
 * Requires authentication.
 * Note: API keys are never logged or stored by this endpoint.
 */
export async function POST(request: NextRequest) {
  // Rate limit — 10 requests per minute per user/IP
  const rateLimitResult = await checkRateLimit(request, 'onboarding:validate-llm', {
    maxRequests: 10,
    windowSeconds: 60,
    identifier: 'user' as const,
  });
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult);
  }

  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Parse request body
    const body: ValidateLLMRequest = await request.json();

    // Validate provider
    const validProviders: LLMProviderType[] = ['anthropic', 'openai', 'google', 'ollama'];
    if (!body.provider || !validProviders.includes(body.provider)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PROVIDER',
            message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
          },
        },
        { status: 400 }
      );
    }

    // Validate key format first (avoids unnecessary network requests)
    const formatResult = validateKeyFormat(body.provider, body.apiKey);
    if (!formatResult.valid) {
      const response: ValidateLLMResponse = { result: formatResult };
      return NextResponse.json(response);
    }

    // Perform provider-specific validation
    let result: LLMValidationResult;

    switch (body.provider) {
      case 'anthropic':
        result = await validateAnthropicKey(body.apiKey!);
        break;

      case 'openai':
        result = await validateOpenAIKey(body.apiKey!);
        break;

      case 'google':
        result = await validateGoogleKey(body.apiKey!);
        break;

      case 'ollama':
        result = await validateOllamaConnection(body.baseUrl || '');
        break;

      default:
        result = {
          valid: false,
          error: 'Unsupported provider',
        };
    }

    const response: ValidateLLMResponse = { result };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error validating LLM configuration:', error);

    // Check for JSON parse error
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON in request body' } },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to validate LLM configuration',
        },
      },
      { status: 500 }
    );
  }
}
