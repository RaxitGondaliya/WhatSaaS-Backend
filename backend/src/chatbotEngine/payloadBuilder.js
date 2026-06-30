/**
 * PayloadBuilder — Converts DB node objects into WhatsApp Cloud API payloads.
 *
 * Each builder is a pure function: (node, to) → WhatsApp API payload object.
 * Supports: Text, Button Message, Image, Video, Audio, Document, List Message
 */

class PayloadBuilder {
  /**
   * Build the correct WhatsApp payload from a flow node.
   * @param {Object} node - The flow node from DB
   * @param {string} to - Recipient phone number
   * @returns {Object} WhatsApp Cloud API payload
   */
  build(node, to) {
    const type = (node.type || 'Text').trim();

    switch (type) {
      case 'Text':
        return this.buildText(node, to);

      case 'Button Message':
        return this.buildButtonMessage(node, to);

      case 'Image':
        return this.buildImage(node, to);

      case 'Video':
        return this.buildVideo(node, to);

      case 'Audio':
        return this.buildAudio(node, to);

      case 'Document':
        return this.buildDocument(node, to);

      case 'List Message':
        return this.buildListMessage(node, to);

      case 'Ask Question / Collect Answer':
        // Treated as a text message (the question itself)
        return this.buildText(node, to);

      default:
        console.warn(`[PayloadBuilder] Unknown node type: "${type}", falling back to text`);
        return this.buildText(node, to);
    }
  }

  /**
   * Text message payload
   */
  buildText(node, to) {
    const body = node.text || node.caption || '';

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: body || 'No message configured.',
      },
    };
  }

  /**
   * Interactive Button Message payload (max 3 buttons per WhatsApp API)
   */
  buildButtonMessage(node, to) {
    const buttons = (node.buttons || []).slice(0, 3);

    // If no buttons, fall back to plain text
    if (buttons.length === 0) {
      return this.buildText(node, to);
    }

    const buttonPayload = buttons.map((btn, index) => ({
      type: 'reply',
      reply: {
        id: String(btn.nextMessageId || btn.id || `btn_${index}`),
        title: (btn.text || `Option ${index + 1}`).substring(0, 20),
      },
    }));

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: node.text || 'Please select an option:',
        },
        action: {
          buttons: buttonPayload,
        },
      },
    };

    // Add optional header
    if (node.header) {
      payload.interactive.header = {
        type: 'text',
        text: node.header,
      };
    }

    // Add optional footer
    if (node.footer) {
      payload.interactive.footer = {
        text: node.footer,
      };
    }

    return payload;
  }

  /**
   * Image message payload
   */
  buildImage(node, to) {
    const image = {};

    if (node.mediaId) {
      image.id = node.mediaId;
    } else if (node.mediaUrl) {
      image.link = node.mediaUrl;
    } else {
      // No media available, fall back to text
      console.warn('[PayloadBuilder] Image node has no mediaUrl or mediaId, sending text');
      return this.buildText(node, to);
    }

    if (node.caption) {
      image.caption = node.caption;
    }

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image,
    };
  }

  /**
   * Video message payload
   */
  buildVideo(node, to) {
    const video = {};

    if (node.mediaId) {
      video.id = node.mediaId;
    } else if (node.mediaUrl) {
      video.link = node.mediaUrl;
    } else {
      console.warn('[PayloadBuilder] Video node has no mediaUrl or mediaId, sending text');
      return this.buildText(node, to);
    }

    if (node.caption) {
      video.caption = node.caption;
    }

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video,
    };
  }

  /**
   * Audio message payload
   */
  buildAudio(node, to) {
    const audio = {};

    if (node.mediaId) {
      audio.id = node.mediaId;
    } else if (node.mediaUrl) {
      audio.link = node.mediaUrl;
    } else {
      console.warn('[PayloadBuilder] Audio node has no mediaUrl or mediaId, sending text');
      return this.buildText(node, to);
    }

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio,
    };
  }

  /**
   * Document message payload
   */
  buildDocument(node, to) {
    const document = {};

    if (node.mediaId) {
      document.id = node.mediaId;
    } else if (node.mediaUrl) {
      document.link = node.mediaUrl;
    } else {
      console.warn('[PayloadBuilder] Document node has no mediaUrl or mediaId, sending text');
      return this.buildText(node, to);
    }

    if (node.caption) {
      document.caption = node.caption;
    }

    if (node.filename) {
      document.filename = node.filename;
    }

    return {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document,
    };
  }

  /**
   * Interactive List Message payload
   */
  buildListMessage(node, to) {
    const sections = (node.sections || []).map((section) => ({
      title: (section.title || 'Options').substring(0, 24),
      rows: (section.rows || []).slice(0, 10).map((row) => ({
        id: String(row.nextMessageId || row.id || row.title || 'row'),
        title: (row.title || 'Option').substring(0, 24),
        description: (row.description || '').substring(0, 72),
      })),
    }));

    // If no sections, fall back to text
    if (sections.length === 0 || sections.every((s) => s.rows.length === 0)) {
      return this.buildText(node, to);
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: node.text || 'Please select from the list:',
        },
        action: {
          button: (node.listButtonText || 'Select an option').substring(0, 20),
          sections,
        },
      },
    };

    // Add optional header
    if (node.header) {
      payload.interactive.header = {
        type: 'text',
        text: node.header,
      };
    }

    // Add optional footer
    if (node.footer) {
      payload.interactive.footer = {
        text: node.footer,
      };
    }

    return payload;
  }

  /**
   * Get a human-readable description of the payload type for logging.
   */
  describePayload(payload) {
    if (!payload) return 'null';
    if (payload.type === 'interactive') {
      return `interactive/${payload.interactive?.type || 'unknown'}`;
    }
    return payload.type || 'unknown';
  }
}

module.exports = new PayloadBuilder();
