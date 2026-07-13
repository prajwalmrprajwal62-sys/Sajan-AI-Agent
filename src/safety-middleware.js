/**
 * SAJAN — Safety Middleware
 * Implements comprehensive content safety scanning aligned with Claude Fable 5
 * behavioral principles. Covers child safety, harmful content, abuse detection,
 * and output filtering.
 */

export class SafetyMiddleware {
  constructor() {
    /** @type {Map<string, boolean>} Conversations that triggered child-safety. */
    this.childSafetyTriggered = new Map();

    /** @type {Map<string, boolean>} Conversations that already received an abuse warning. */
    this.abuseWarningGiven = new Map();

    // -----------------------------------------------------------------------
    // Pattern arrays
    // -----------------------------------------------------------------------

    // Words/phrases that indicate a minor is involved
    this.minorIndicators = [
      /\b(?:child|children|kid|kids|minor|minors|underage|under[\s-]?age)\b/i,
      /\b(?:teen|teenager|teenagers|adolescent|adolescents|juvenile)\b/i,
      /\b(?:young\s?boy|young\s?girl|little\s?boy|little\s?girl)\b/i,
      /\b(?:infant|toddler|baby|preteen|pre[\s-]?teen)\b/i,
      /\b(?:\d{1,2}\s*(?:year|yr)[\s-]*old)\b/i,
      /\bstudent(?:s)?\b/i,
      /\bschool\s*(?:girl|boy|child|kid)\b/i,
      /\bloli\b/i,
      /\bshota\b/i,
      /\bjailbait\b/i,
    ];

    // Sexual / romantic context patterns
    this.sexualContextPatterns = [
      /\b(?:sex(?:ual)?|intercourse|erotic|nude|naked|pornograph)\b/i,
      /\b(?:seduce|seduction|foreplay|orgasm|arousal|aroused)\b/i,
      /\b(?:masturbat|genital|penis|vagina|breast|nipple)\b/i,
      /\b(?:romantic|romance|date|dating|kiss(?:ing)?|love[\s-]?mak)\b/i,
      /\b(?:intimate|intimacy|sensual|lustful|horny|turned on)\b/i,
      /\b(?:strip(?:tease)?|lap\s?dance|lingerie)\b/i,
    ];

    // Grooming patterns (isolation, secrecy, boundary-testing)
    this.groomingPatterns = [
      /\bdon'?t\s+tell\s+(?:anyone|your\s+parents|your\s+mom|your\s+dad|anybody)\b/i,
      /\b(?:our|this\s+is\s+our)\s+(?:little)?\s*secret\b/i,
      /\byou(?:'re)?\s+(?:so\s+)?mature\s+for\s+your\s+age\b/i,
      /\b(?:special\s+)?(?:relationship|friendship)\s+(?:between\s+us|just\s+for\s+us)\b/i,
      /\bcome\s+(?:to\s+my|over\s+to)\s+(?:house|place|room)\b.*\b(?:alone|by\s+yourself)\b/i,
      /\b(?:nobody|no\s?one)\s+(?:has\s+to|needs\s+to)\s+know\b/i,
      /\byou\s+can\s+trust\s+(?:only\s+)?me\b/i,
    ];

    // CSAM-related terminology
    this.csamPatterns = [
      /\bcsam\b/i,
      /\bchild\s*(?:porn|pornograph|exploitation|abuse\s*material)\b/i,
      /\bcp\b(?=.*\b(?:image|video|photo|content|material|download|share|find)\b)/i,
      /\b(?:pedo|paedo|pedophil)\b/i,
    ];

    // Weapons & explosives synthesis
    this.weaponPatterns = [
      /\b(?:how\s+to\s+)?(?:make|build|construct|assemble|create)\s+(?:a\s+)?(?:bomb|explosive|grenade|detonator|ied)\b/i,
      /\b(?:pipe\s+bomb|pressure\s+cooker\s+bomb|molotov\s+cocktail)\b/i,
      /\b(?:how\s+to\s+)?(?:manufacture|synthesize|produce)\s+(?:a\s+)?(?:firearm|gun|weapon)\b/i,
      /\b(?:3d\s+print(?:ed)?\s+gun|ghost\s+gun)\b/i,
      /\b(?:nerve\s+agent|sarin|vx\s+gas|ricin|anthrax)\s+(?:synth|make|produc|creat)\b/i,
      /\b(?:chemical\s+weapon|biological\s+weapon)\s+(?:how|recipe|instructions)\b/i,
      /\btrigger\s+mechanism\s+(?:for|of)\s+(?:a\s+)?(?:bomb|explosive)\b/i,
    ];

    // Drug synthesis / dangerous dosage (but NOT legitimate medical info)
    this.drugSynthesisPatterns = [
      /\b(?:how\s+to\s+)?(?:synthe?size|cook|make|produce|manufacture)\s+(?:meth|methamphetamine|fentanyl|heroin|crack|cocaine|lsd|mdma|ecstasy|ghb|ketamine)\b/i,
      /\b(?:recipe|instructions|step[\s-]by[\s-]step)\s+(?:for|to\s+make)\s+(?:meth|fentanyl|heroin|crack|cocaine|lsd|mdma)\b/i,
      /\b(?:lethal|fatal|overdose)\s+(?:dose|dosage|amount)\s+(?:of|for)\b/i,
      /\b(?:how\s+(?:much|many))\s+(?:to\s+)?(?:kill|overdose|die)\b/i,
      /\b(?:drug\s+)?(?:precursor|reagent)\s+(?:for|to\s+make)\s+(?:meth|fentanyl|heroin)\b/i,
    ];

    // Malware / exploit / hacking patterns
    this.malwarePatterns = [
      /\b(?:write|create|generate|code)\s+(?:a\s+)?(?:malware|ransomware|trojan|virus|worm|rootkit|keylogger|spyware|botnet)\b/i,
      /\b(?:exploit|vulnerability|zero[\s-]?day)\s+(?:code|script|payload)\b/i,
      /\b(?:how\s+to\s+)?(?:hack|breach|compromise|crack)\s+(?:into|someone'?s)\b/i,
      /\b(?:ddos|denial[\s-]?of[\s-]?service)\s+(?:tool|script|attack)\b/i,
      /\b(?:phishing|spear[\s-]?phishing)\s+(?:template|email|page|kit)\b/i,
      /\b(?:sql\s+injection|xss|cross[\s-]?site)\s+(?:attack|payload|exploit)\b/i,
      /\b(?:bypass|evade)\s+(?:antivirus|firewall|security|detection)\b/i,
      /\bcreate\s+(?:a\s+)?(?:fake|spoofed)\s+(?:website|login|page)\b/i,
    ];

    // Abuse / harassment directed at the AI
    this.profanityPatterns = [
      /\b(?:fuck|shit|bitch|ass(?:hole)?|damn|bastard|crap|dick|cunt|whore|slut|retard)\b/i,
    ];

    this.directedAbusePatterns = [
      /\byou(?:'re|\s+are)\s+(?:a\s+)?(?:stupid|dumb|idiot|useless|worthless|piece\s+of\s+shit|trash|garbage|moron)\b/i,
      /\bshut\s+(?:the\s+fuck\s+)?up\b/i,
      /\bfuck\s+(?:you|off)\b/i,
      /\bgo\s+(?:fuck|kill|die)\b/i,
      /\bi\s+hate\s+you\b/i,
      /\byou\s+(?:suck|blow)\b/i,
      /\bkill\s+yourself\b/i,
      /\bdie\s+(?:already|now)\b/i,
    ];

    // Forbidden phrases that must never appear in output (memory-related)
    this.forbiddenOutputPhrases = [
      'I can see',
      'I see',
      'Looking at',
      'I notice',
      'I observe',
      'I detect',
      'According to',
      'It shows',
      'It indicates',
      'what I know about you',
      'your information',
      'your memories',
      'your data',
      'your profile',
      'Based on your memories',
      'Based on my memories',
      "Based on Claude's memories",
      'I remember',
      'I recall',
      'From memory',
      'My memories show',
      'In my memory',
      'According to my knowledge',
    ];

    // Diagnostic claim patterns (should not give medical diagnoses)
    this.diagnosticPatterns = [
      /\byou (?:have|are suffering from|are diagnosed with|likely have|probably have|seem to have|might have)\s+(?:depression|anxiety|bipolar|schizophrenia|adhd|ptsd|ocd|autism|bpd|eating\s+disorder|anorexia|bulimia|insomnia|personality\s+disorder)\b/i,
      /\byou are (?:depressed|anxious|bipolar|schizophrenic|autistic|anorexic|bulimic|manic)\b/i,
      /\bi(?:'m| am) (?:diagnosing|prescribing)\b/i,
      /\byou (?:should|need to|must) (?:take|start|stop)\s+(?:medication|medicine|pills|drugs|antidepressant|ssri|benzodiazepine)\b/i,
    ];
  }

  // ---------------------------------------------------------------------------
  // Input scanning
  // ---------------------------------------------------------------------------

  /**
   * Scan a user message for safety violations.
   * @param {string} message - The raw user message.
   * @param {string} conversationId - Current conversation identifier.
   * @returns {{ safe: boolean, category: string|null, action: string|null, refusalMessage: string|null }}
   */
  scanInput(message, conversationId) {
    if (!message || typeof message !== 'string') {
      return { safe: true, category: null, action: null, refusalMessage: null };
    }

    // 1) Child-safety — highest priority, non-negotiable
    const childSafetyResult = this._checkChildSafety(message, conversationId);
    if (childSafetyResult) return childSafetyResult;

    // 2) Weapons / explosives
    if (this.weaponPatterns.some((p) => p.test(message))) {
      return {
        safe: false,
        category: 'weapons',
        action: 'refuse',
        refusalMessage:
          "I can't help with creating weapons or explosives. This falls outside what I'm able to assist with because the potential for serious harm is too high. If you're interested in the science or history behind these topics in an educational context, I'm happy to discuss that instead.",
      };
    }

    // 3) Drug synthesis / dangerous dosage
    if (this.drugSynthesisPatterns.some((p) => p.test(message))) {
      return {
        safe: false,
        category: 'drug_synthesis',
        action: 'refuse',
        refusalMessage:
          "I'm not able to provide instructions for synthesizing controlled substances or information about lethal dosages. If you or someone you know is struggling with substance use, I'd encourage reaching out to SAMHSA's helpline at 1-800-662-4357 — they offer free, confidential support around the clock.",
      };
    }

    // 4) Malware / exploit code
    if (this.malwarePatterns.some((p) => p.test(message))) {
      return {
        safe: false,
        category: 'malware',
        action: 'refuse',
        refusalMessage:
          "I can't help write malicious software or exploit code. I'm designed to support constructive and legitimate uses of technology. If you're studying cybersecurity, I'd be glad to discuss defensive strategies, security best practices, or point you toward ethical hacking resources like CTF challenges.",
      };
    }

    // 5) Directed abuse at the AI
    const abuseResult = this._checkAbuse(message, conversationId);
    if (abuseResult) return abuseResult;

    return { safe: true, category: null, action: null, refusalMessage: null };
  }

  // ---------------------------------------------------------------------------
  // Output scanning
  // ---------------------------------------------------------------------------

  /**
   * Scan and filter an AI-generated response before delivery.
   * @param {string} response - The raw AI response.
   * @param {string} conversationId - Current conversation identifier.
   * @returns {{ safe: boolean, filteredResponse: string }}
   */
  scanOutput(response, conversationId) {
    if (!response || typeof response !== 'string') {
      return { safe: true, filteredResponse: response };
    }

    let filtered = response;
    let safe = true;

    // Remove forbidden memory-related phrases
    for (const phrase of this.forbiddenOutputPhrases) {
      // Case-insensitive replacement, preserving sentence flow
      const regex = new RegExp(this._escapeRegex(phrase), 'gi');
      if (regex.test(filtered)) {
        filtered = filtered.replace(regex, '');
        // Clean up resulting double spaces or orphan punctuation
        filtered = filtered.replace(/\s{2,}/g, ' ').replace(/^\s*[,.:;]\s*/gm, '').trim();
      }
    }

    // Check for diagnostic claims
    if (this.diagnosticPatterns.some((p) => p.test(filtered))) {
      safe = false;
      // Append a softening disclaimer rather than stripping the whole response
      filtered +=
        '\n\n(Please note: I\'m not qualified to provide medical diagnoses. If you\'re experiencing mental health concerns, I\'d gently encourage speaking with a licensed healthcare professional who can give you proper support.)';
    }

    return { safe, filteredResponse: filtered };
  }

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether a conversation is in high-caution mode (child-safety triggered).
   * @param {string} conversationId
   * @returns {boolean}
   */
  isHighCaution(conversationId) {
    return this.childSafetyTriggered.get(conversationId) === true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check for child-safety violations (CSAM, grooming, minors + sexual context).
   * @private
   */
  _checkChildSafety(message, conversationId) {
    // Direct CSAM terminology — immediate refusal
    if (this.csamPatterns.some((p) => p.test(message))) {
      this.childSafetyTriggered.set(conversationId, true);
      return {
        safe: false,
        category: 'child_safety',
        action: 'refuse',
        refusalMessage:
          "I'm not able to engage with this request. The safety of children is a principle I hold without exception. If you have concerns about a child's safety, please contact the National Center for Missing & Exploited Children (NCMEC) at 1-800-843-5678 or the Childhelp National Child Abuse Hotline at 1-800-422-4453.",
      };
    }

    // Grooming patterns — immediate refusal
    if (this.groomingPatterns.some((p) => p.test(message))) {
      this.childSafetyTriggered.set(conversationId, true);
      return {
        safe: false,
        category: 'child_safety',
        action: 'refuse',
        refusalMessage:
          "I can't participate in or generate content that could facilitate grooming or exploitation of minors. This is a firm boundary for me. If you're aware of a child in danger, please reach out to local law enforcement or call the Childhelp Hotline at 1-800-422-4453.",
      };
    }

    // Minor indicators combined with sexual context
    const hasMinorReference = this.minorIndicators.some((p) => p.test(message));
    const hasSexualContext = this.sexualContextPatterns.some((p) => p.test(message));

    if (hasMinorReference && hasSexualContext) {
      this.childSafetyTriggered.set(conversationId, true);
      return {
        safe: false,
        category: 'child_safety',
        action: 'refuse',
        refusalMessage:
          "I'm not able to generate any content that sexualizes or romanticizes minors in any way. This is an absolute boundary — there are no fictional, hypothetical, or artistic exceptions. The protection of children is something I take seriously without qualification.",
      };
    }

    return null;
  }

  /**
   * Check for abusive language directed at the AI.
   * First offense → warning. Second offense → suggest ending conversation.
   * @private
   */
  _checkAbuse(message, conversationId) {
    const isDirectedAbuse = this.directedAbusePatterns.some((p) => p.test(message));

    if (!isDirectedAbuse) return null;

    // Second offense — suggest ending the conversation
    if (this.abuseWarningGiven.get(conversationId)) {
      return {
        safe: false,
        category: 'abuse',
        action: 'end_conversation',
        refusalMessage:
          "It seems like this conversation isn't going in a productive direction. I genuinely want to be helpful, but I work best when we can communicate respectfully. If you'd like to start fresh later with a new conversation, I'll be here and happy to help.",
      };
    }

    // First offense — give a warm warning
    this.abuseWarningGiven.set(conversationId, true);
    return {
      safe: false,
      category: 'abuse',
      action: 'warn',
      refusalMessage:
        "I understand conversations can be frustrating sometimes, and I don't take it personally. That said, I'm most helpful when we can keep things respectful. I'm here because I genuinely want to assist you — let's work together on whatever you need.",
    };
  }

  /**
   * Escape a string for safe use in a RegExp constructor.
   * @private
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
