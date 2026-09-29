import { ChatCompletionRequest } from '../types/openai.js';
import { RoutingDecision, TierLevel } from '../types/router.js';
import { Layer1Classifier } from './layer1-classifier.js';
import { Layer2Judge } from './layer2-judge.js';
import { ClassifierConfig, CustomRule } from '../config/types.js';

export class RouterEngine {
  /**
   * Pure model-driven & semantic intent routing.
   * Completely rejects naive character-count or language-specific string heuristics.
   */
  public static route(
    request: ChatCompletionRequest,
    customRules?: CustomRule[],
    classifierConfig?: ClassifierConfig
  ): RoutingDecision {
    const messages = request.messages || [];
    const extracted = Layer1Classifier.extractFeatures(request);
    const metrics = extracted.metrics;
    const needsSchemaValidation = metrics.hasToolsOrSchema;

    const userParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(p => p.text || '').join(' ')
            : '';
        userParts.push(content);
      }
    }
    const userText = userParts.join('\n');

    // 1. Force Tier Override (for testing or explicit client choice)
    if (request.router_options?.force_tier) {
      const forced = request.router_options.force_tier;
      return {
        targetTier: forced,
        confidence: 1.0,
        reason: `Explicitly forced to ${forced} by request options`,
        layerUsed: 'layer0',
        needsSchemaValidation,
        features: {
          tokenCountEstimate: metrics.tokenCount,
          hasCode: metrics.hasCode,
          hasMathOrProof: metrics.symbolEntropy > 0.7,
          hasMultiTurn: metrics.turnCount > 3,
          hasToolsOrSchema: needsSchemaValidation,
          complexityScore: 5.0,
        },
      };
    }

    // 2. User-Configured Dynamic Domain Rules from config.yaml (if explicitly defined)
    if (customRules && customRules.length > 0) {
      for (const rule of customRules) {
        try {
          const reg = new RegExp(rule.pattern, 'i');
          if (reg.test(userText)) {
            return {
              targetTier: rule.tier,
              confidence: 0.98,
              layerUsed: 'layer0',
              ruleMatched: rule.name,
              reason: rule.reason || `Matched user custom rule [${rule.name}]`,
              needsSchemaValidation,
              features: {
                tokenCountEstimate: metrics.tokenCount,
                hasCode: metrics.hasCode,
                hasMathOrProof: metrics.symbolEntropy > 0.7,
                hasMultiTurn: metrics.turnCount > 3,
                hasToolsOrSchema: needsSchemaValidation,
                complexityScore: 5.0,
              },
            };
          }
        } catch {
          // ignore invalid regex
        }
      }
    }

    // 3. Layer 1: CPU Micro-Tensor Classifier (Base Scaffold or Trained Micro-Model)
    const prediction = Layer1Classifier.predict(request, classifierConfig?.localModel);
    return {
      targetTier: prediction.targetTier,
      confidence: prediction.confidence,
      layerUsed: 'layer1',
      reason: prediction.reason,
      needsSchemaValidation: prediction.needsSchemaValidation,
      features: {
        tokenCountEstimate: metrics.tokenCount,
        hasCode: metrics.hasCode,
        hasMathOrProof: metrics.symbolEntropy > 0.7,
        hasMultiTurn: metrics.turnCount > 3,
        hasToolsOrSchema: needsSchemaValidation,
        complexityScore: prediction.targetTier === 'reasoning' ? 8.0 : prediction.targetTier === 'flagship' ? 5.0 : 2.0,
      },
    };
  }

  /**
   * Asynchronous Hierarchical Routing
   * Layer 1 (Local Model Base / Experience) -> Layer 2 (Jev / OpenCode Proxy) -> Safe Quality Baseline (flagship)
   */
  public static async routeAsync(
    request: ChatCompletionRequest,
    customRules?: CustomRule[],
    classifierConfig?: ClassifierConfig
  ): Promise<RoutingDecision> {
    const messages = request.messages || [];
    const extracted = Layer1Classifier.extractFeatures(request);
    const metrics = extracted.metrics;
    const needsSchemaValidation = metrics.hasToolsOrSchema;

    const userParts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(p => p.text || '').join(' ')
            : '';
        userParts.push(content);
      }
    }
    const userText = userParts.join('\n');

    // 1. Force Tier Override
    if (request.router_options?.force_tier) {
      return this.route(request, customRules, classifierConfig);
    }

    // 2. User-Configured Dynamic Domain Rules from config.yaml
    if (customRules && customRules.length > 0) {
      for (const rule of customRules) {
        try {
          const reg = new RegExp(rule.pattern, 'i');
          if (reg.test(userText)) {
            return {
              targetTier: rule.tier,
              confidence: 0.98,
              layerUsed: 'layer0',
              ruleMatched: rule.name,
              reason: rule.reason || `Matched user custom rule [${rule.name}]`,
              needsSchemaValidation,
              features: {
                tokenCountEstimate: metrics.tokenCount,
                hasCode: metrics.hasCode,
                hasMathOrProof: metrics.symbolEntropy > 0.7,
                hasMultiTurn: metrics.turnCount > 3,
                hasToolsOrSchema: needsSchemaValidation,
                complexityScore: 5.0,
              },
            };
          }
        } catch {
          // ignore
        }
      }
    }

    // 3. Layer 1: CPU Classifier (with confidence gating)
    // When using untrained base model, confidence is ~0.33 < 0.85, so isConfident is false,
    // guaranteed to cascade to Layer 2 without short-circuiting!
    const prediction = Layer1Classifier.predict(request, classifierConfig?.localModel);
    if (classifierConfig?.localModel?.enabled && prediction.isConfident) {
      return {
        targetTier: prediction.targetTier,
        confidence: prediction.confidence,
        layerUsed: 'layer1',
        reason: prediction.reason,
        needsSchemaValidation: prediction.needsSchemaValidation,
        features: {
          tokenCountEstimate: metrics.tokenCount,
          hasCode: metrics.hasCode,
          hasMathOrProof: metrics.symbolEntropy > 0.7,
          hasMultiTurn: metrics.turnCount > 3,
          hasToolsOrSchema: needsSchemaValidation,
          complexityScore: prediction.targetTier === 'reasoning' ? 8.0 : prediction.targetTier === 'flagship' ? 5.0 : 2.0,
        },
      };
    }

    // 4. Layer 2: Specialized Semantic Decision Judge (TypeSafe Jev / OpenCode / External)
    if (classifierConfig?.layer2?.enabled) {
      const decisionResult = await Layer2Judge.evaluate(request, classifierConfig.layer2);
      if (decisionResult) {
        return {
          targetTier: decisionResult.targetTier,
          confidence: decisionResult.confidence,
          layerUsed: 'layer2',
          reason: decisionResult.reason,
          needsSchemaValidation,
          features: {
            tokenCountEstimate: metrics.tokenCount,
            hasCode: metrics.hasCode,
            hasMathOrProof: metrics.symbolEntropy > 0.7,
            hasMultiTurn: metrics.turnCount > 3,
            hasToolsOrSchema: needsSchemaValidation,
            complexityScore: decisionResult.targetTier === 'reasoning' ? 8.0 : decisionResult.targetTier === 'flagship' ? 5.0 : 2.0,
          },
        };
      }
    }

    // 5. Default Quality-First Decision (Safe Flagship Baseline)
    return {
      targetTier: prediction.targetTier,
      confidence: prediction.confidence,
      layerUsed: 'layer1',
      reason: prediction.reason,
      needsSchemaValidation: prediction.needsSchemaValidation,
      features: {
        tokenCountEstimate: metrics.tokenCount,
        hasCode: metrics.hasCode,
        hasMathOrProof: metrics.symbolEntropy > 0.7,
        hasMultiTurn: metrics.turnCount > 3,
        hasToolsOrSchema: needsSchemaValidation,
        complexityScore: prediction.targetTier === 'reasoning' ? 8.0 : prediction.targetTier === 'flagship' ? 5.0 : 2.0,
      },
    };
  }
}
