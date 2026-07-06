const { resolveButtonClickRoute } = require('../buttonRouting');

describe('resolveButtonClickRoute', () => {
  let mockFlow;
  let mockBusinessId;

  beforeEach(() => {
    mockBusinessId = 'tenant_123';
    mockFlow = {
      _id: 'flow_456',
      nodes: [
        {
          id: 'node_1',
          type: 'Button Message',
          data: {
            buttons: [
              { id: 'btn_1', buttonId: 'payload_yes', text: 'Yes', nextMessageId: 'node_2' },
              { id: 'btn_2', buttonId: 'payload_no', text: 'No', nextMessageId: 'node_3' }
            ]
          }
        },
        {
          id: 'node_2',
          type: 'Text',
          data: { text: 'You said yes!' }
        },
        {
          id: 'node_3',
          type: 'Text',
          data: { text: 'You said no!' }
        },
        {
          id: 'node_4',
          type: 'Button Message',
          data: {
            buttons: [
              { id: 'btn_3', buttonId: 'payload_opt1', text: 'Option 1', nextMessageId: '' },
              { id: 'btn_4', buttonId: 'payload_opt2', text: 'Option 2', nextMessageId: '' },
              { id: 'btn_5', buttonId: 'payload_opt3', text: 'Option 3', nextMessageId: '' },
              { id: 'btn_6', buttonId: 'payload_opt4', text: 'Option 4', nextMessageId: '' },
              { id: 'btn_7', buttonId: 'payload_opt5', text: 'Option 5', nextMessageId: '' }
            ]
          }
        },
        {
          id: 'node_5',
          triggerType: 'button_click',
          triggerId: 'payload_opt1',
          type: 'Text',
          data: { text: 'You chose option 1' }
        },
        {
          id: 'node_fallback',
          triggerType: 'default',
          type: 'Text',
          data: { text: 'I didn\'t understand.' }
        }
      ]
    };
    
    // Mock console.warn
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should route directly via nextMessageId for a 2-button node (fast path)', () => {
    const currentNode = mockFlow.nodes.find(n => n.id === 'node_1');
    const result = resolveButtonClickRoute('payload_yes', currentNode, mockFlow, mockBusinessId);
    
    expect(result).not.toBeNull();
    expect(result.routeType).toBe('direct_next_message');
    expect(result.targetNodeId).toBe('node_2');
    expect(result.matchedButton.text).toBe('Yes');
  });

  it('should support any number of buttons (e.g., 5-button node fallback scan)', () => {
    const currentNode = mockFlow.nodes.find(n => n.id === 'node_4');
    // For payload_opt1, nextMessageId is empty, so it should scan the flow and find node_5
    const result = resolveButtonClickRoute('payload_opt1', currentNode, mockFlow, mockBusinessId);
    
    expect(result).not.toBeNull();
    expect(result.routeType).toBe('flow_scan_fallback');
    expect(result.targetNodeId).toBe('node_5');
    expect(result.matchedButton.text).toBe('Option 1');
  });

  it('should route to the global fallback node when payload is unmatched', () => {
    const currentNode = mockFlow.nodes.find(n => n.id === 'node_1');
    const result = resolveButtonClickRoute('unknown_payload', currentNode, mockFlow, mockBusinessId);
    
    expect(result).not.toBeNull();
    expect(result.routeType).toBe('global_fallback');
    expect(result.targetNodeId).toBe('node_fallback');
    expect(result.matchedButton).toBeNull();
    
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unmatched buttonId: unknown_payload')
    );
  });

  it('should fallback to matching btn.id if buttonId is missing', () => {
    // Legacy support test
    const legacyFlow = {
      _id: 'flow_legacy',
      nodes: [
        {
          id: 'node_legacy',
          buttons: [
            { id: 'internal_id_123', text: 'Legacy Yes', nextMessageId: 'node_target' }
          ]
        },
        {
          id: 'node_target'
        }
      ]
    };
    const currentNode = legacyFlow.nodes[0];
    const result = resolveButtonClickRoute('internal_id_123', currentNode, legacyFlow, mockBusinessId);
    
    expect(result).not.toBeNull();
    expect(result.routeType).toBe('direct_next_message');
    expect(result.targetNodeId).toBe('node_target');
    expect(result.matchedButton.text).toBe('Legacy Yes');
  });
});
