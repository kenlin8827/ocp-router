import { ResponseFormat } from '../types/openai.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  parsed?: any;
}

export class SchemaAssertion {
  /**
   * Cleans model output, stripping markdown code fences like ```json ... ```
   */
  public static extractJsonString(raw: string): string {
    const trimmed = raw.trim();
    // 1. Look for ```json ... ```
    const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonBlockMatch && jsonBlockMatch[1]) {
      return jsonBlockMatch[1].trim();
    }

    // 2. Look for outermost { ... } or [ ... ]
    const firstBrace = trimmed.indexOf('{');
    const firstBracket = trimmed.indexOf('[');
    
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = trimmed.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = trimmed.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return trimmed.slice(startIdx, endIdx + 1);
    }

    return trimmed;
  }

  /**
   * Fast static schema & syntax assertion
   */
  public static validate(rawText: string, responseFormat?: ResponseFormat): ValidationResult {
    if (!rawText || rawText.trim().length === 0) {
      return { valid: false, error: 'Empty output received from model' };
    }

    const jsonStr = this.extractJsonString(rawText);

    // 1. JSON Syntax Check (SyntaxError)
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err: any) {
      return {
        valid: false,
        error: `JSON SyntaxError: ${err.message}. Output was not valid JSON.`,
      };
    }

    // 2. If no specific schema is declared, basic type and null check
    if (!responseFormat || responseFormat.type !== 'json_schema' || !responseFormat.json_schema?.schema) {
      if (typeof parsed !== 'object' || parsed === null) {
        return {
          valid: false,
          error: `Expected JSON object/array but got ${typeof parsed}`,
        };
      }
      return { valid: true, parsed };
    }

    // 3. Schema-based assertions (Required keys, Types, Enums)
    const schema = responseFormat.json_schema.schema;
    const schemaErr = this.checkSchemaCompliance(parsed, schema);
    if (schemaErr) {
      return { valid: false, error: schemaErr, parsed };
    }

    return { valid: true, parsed };
  }

  /**
   * Lightweight validator for JSON Schema properties, required fields, and enums
   */
  private static checkSchemaCompliance(data: any, schema: Record<string, any>, path = ''): string | null {
    if (schema.type === 'object') {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return `Field '${path || 'root'}' must be an object`;
      }

      // Check required fields
      if (Array.isArray(schema.required)) {
        for (const reqKey of schema.required) {
          if (!(reqKey in data) || data[reqKey] === undefined || data[reqKey] === null) {
            return `Missing required key '${path ? `${path}.${reqKey}` : reqKey}'`;
          }
        }
      }

      // Check properties recursively
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [propKey, propSchema] of Object.entries<any>(schema.properties)) {
          if (propKey in data) {
            const err = this.checkSchemaCompliance(data[propKey], propSchema, path ? `${path}.${propKey}` : propKey);
            if (err) return err;
          }
        }
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(data)) {
        return `Field '${path || 'root'}' must be an array`;
      }
      if (schema.items) {
        for (let i = 0; i < data.length; i++) {
          const err = this.checkSchemaCompliance(data[i], schema.items, `${path}[${i}]`);
          if (err) return err;
        }
      }
    } else if (schema.type === 'string') {
      if (typeof data !== 'string') {
        return `Field '${path}' must be a string, got ${typeof data}`;
      }
      if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
        return `Field '${path}' has invalid enum value '${data}'. Allowed: [${schema.enum.join(', ')}]`;
      }
    } else if (schema.type === 'number' || schema.type === 'integer') {
      if (typeof data !== 'number' || Number.isNaN(data)) {
        return `Field '${path}' must be a number, got ${typeof data}`;
      }
      if (schema.type === 'integer' && !Number.isInteger(data)) {
        return `Field '${path}' must be an integer`;
      }
    } else if (schema.type === 'boolean') {
      if (typeof data !== 'boolean') {
        return `Field '${path}' must be a boolean, got ${typeof data}`;
      }
    }

    return null;
  }
}
