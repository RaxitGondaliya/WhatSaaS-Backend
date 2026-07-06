/**
 * One-time migration script to normalize existing flows in the database.
 * 
 * What it does:
 * 1. Assigns unique variable names to each node (replacing "customer_name" everywhere)
 * 2. Generates buttonId for any button missing one
 * 3. Sets nextMessageId to sequential next node for buttons with empty routing
 * 4. Normalizes node structure so node.data is the canonical location
 * 
 * Usage: node migrate_normalize_flows.js [--dry-run]
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.');
  console.log(DRY_RUN ? '=== DRY RUN MODE — No changes will be saved ===' : '=== LIVE MODE — Changes will be saved ===');
  console.log('');

  const ChatbotFlow = require('./src/models/ChatbotFlow');
  const flows = await ChatbotFlow.find({});

  console.log(`Found ${flows.length} flow(s) to process.\n`);

  for (const flow of flows) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`FLOW: "${flow.flowName}" (${flow._id}) | status: ${flow.status}`);
    console.log(`${'='.repeat(60)}`);

    if (!flow.nodes || flow.nodes.length === 0) {
      console.log('  No nodes. Skipping.');
      continue;
    }

    let hasChanges = false;
    const usedVariables = new Set();

    for (let i = 0; i < flow.nodes.length; i++) {
      const node = flow.nodes[i];
      const data = node.data || {};
      const nodeId = node.id || data.id || `node_${i}`;
      const buttons = data.buttons || node.buttons || [];
      const rawType = (data.type || node.type || '').toLowerCase();
      const isButtonNode = buttons.length > 0 || rawType.includes('button');
      const isEndNode = rawType === 'end' || rawType === 'text' && i >= flow.nodes.length - 2;
      
      console.log(`\n  --- Node ${i}: ${nodeId} (type: ${data.type || node.type || 'unknown'}) ---`);

      // === 1. Ensure node has an id ===
      if (!node.id) {
        console.log(`    [FIX] Missing node.id → setting to "${nodeId}"`);
        node.id = nodeId;
        hasChanges = true;
      }

      // === 2. Ensure node.data exists and is canonical ===
      if (!node.data) {
        node.data = {};
        hasChanges = true;
      }

      // Copy root-level fields into node.data if missing there
      if (node.text && !node.data.text) { node.data.text = node.text; hasChanges = true; }
      if (node.type && !node.data.type) { node.data.type = node.type; hasChanges = true; }
      if (node.buttons && !node.data.buttons) { node.data.buttons = node.buttons; hasChanges = true; }
      if (node.variable && !node.data.variable) { node.data.variable = node.variable; hasChanges = true; }

      // === 3. Assign unique variable names ===
      const currentVar = node.data.variable || node.variable || '';
      let newVar = currentVar;

      // Determine a good variable name based on node position and type
      if (isButtonNode && i === 0) {
        // First button node = service selection
        newVar = 'selected_service';
      } else if (isButtonNode && buttons.some(b => (b.action === 'submit_request' || b.action === 'cancel_request'))) {
        // Confirmation node
        newVar = 'booking_confirmation';
      } else if (isButtonNode) {
        newVar = `selected_option_${i}`;
      } else if (i === 0 && !isButtonNode) {
        // First text node = likely customer name
        newVar = 'customer_name';
      } else {
        // For text input nodes, try to keep meaningful names
        const text = (data.text || node.text || '').toLowerCase();
        if (text.includes('address') || text.includes('adress')) {
          newVar = 'customer_address';
        } else if (text.includes('city') || text.includes('sehpar')) {
          newVar = 'customer_city';
        } else if (text.includes('problem') || text.includes('taklif') || text.includes('issue')) {
          newVar = 'problem_desc';
        } else if (text.includes('cloth') || text.includes('kapda') || text.includes('product')) {
          newVar = 'cloth_id';
        } else if (text.includes('name') || text.includes('naam')) {
          newVar = 'customer_name';
        } else if (text.includes('phone') || text.includes('number') || text.includes('mobile')) {
          newVar = 'customer_phone';
        } else {
          newVar = `user_input_${i}`;
        }
      }

      // Handle collisions: if this variable name is already used by another node, append index
      if (usedVariables.has(newVar)) {
        newVar = `${newVar}_${i}`;
      }
      usedVariables.add(newVar);

      // For end/success/cancel message nodes with no input needed, clear the variable
      const hasSubmitOrCancel = buttons.some(b => b.action === 'submit_request' || b.action === 'cancel_request');
      const isTerminalTextNode = !isButtonNode && i >= flow.nodes.length - 2 && !hasSubmitOrCancel;
      
      if (currentVar !== newVar) {
        console.log(`    [FIX] variable: "${currentVar}" → "${newVar}"`);
        node.data.variable = newVar;
        node.variable = newVar;
        hasChanges = true;
      } else {
        console.log(`    [OK] variable: "${currentVar}"`);
      }

      // === 4. Fix buttons ===
      const nodeButtons = node.data.buttons || node.buttons || [];
      for (let bi = 0; bi < nodeButtons.length; bi++) {
        const btn = nodeButtons[bi];
        
        // Ensure buttonId exists
        if (!btn.buttonId) {
          const newButtonId = `btn_${btn.text ? btn.text.trim().toLowerCase().replace(/\s+/g, '_') : bi}_${Date.now()}_${bi}`;
          console.log(`    [FIX] Button "${btn.text}" missing buttonId → "${newButtonId}"`);
          btn.buttonId = newButtonId;
          hasChanges = true;
        } else {
          console.log(`    [OK] Button "${btn.text}" buttonId: "${btn.buttonId}"`);
        }

        // Ensure nextMessageId exists — set to next sequential node if empty
        if (!btn.nextMessageId || String(btn.nextMessageId).trim() === '') {
          if (i < flow.nodes.length - 1) {
            const nextNodeId = flow.nodes[i + 1].id || `node_${i + 1}`;
            console.log(`    [FIX] Button "${btn.text}" nextMessageId: "" → "${nextNodeId}"`);
            btn.nextMessageId = nextNodeId;
            hasChanges = true;
          }
        } else {
          console.log(`    [OK] Button "${btn.text}" nextMessageId: "${btn.nextMessageId}"`);
        }

        // Ensure action field exists
        if (!btn.action) {
          btn.action = 'none';
        }
      }

      // Update buttons in node.data (canonical location)
      if (nodeButtons.length > 0) {
        node.data.buttons = nodeButtons;
        // Also update root-level buttons to stay in sync
        node.buttons = nodeButtons;
      }

      // === 5. Set nextMessageId for non-button nodes ===
      if (!isButtonNode && (!node.data.nextMessageId || String(node.data.nextMessageId).trim() === '')) {
        if (i < flow.nodes.length - 1) {
          const nextNodeId = flow.nodes[i + 1].id || `node_${i + 1}`;
          console.log(`    [FIX] Node nextMessageId: "" → "${nextNodeId}"`);
          node.data.nextMessageId = nextNodeId;
          node.nextMessageId = nextNodeId;
          hasChanges = true;
        }
      }
    }

    // === 6. Rebuild edges from the normalized nodes ===
    const newEdges = [];
    for (const node of flow.nodes) {
      const data = node.data || {};
      if (data.nextMessageId) {
        newEdges.push({
          id: `edge_${node.id}_${data.nextMessageId}`,
          source: String(node.id),
          target: String(data.nextMessageId)
        });
      }
      const buttons = data.buttons || [];
      for (const btn of buttons) {
        if (btn.nextMessageId) {
          newEdges.push({
            id: `edge_${node.id}_${btn.buttonId || btn.id}_${btn.nextMessageId}`,
            source: String(node.id),
            sourceHandle: String(btn.buttonId || btn.id),
            target: String(btn.nextMessageId)
          });
        }
      }
    }

    if (hasChanges) {
      console.log(`\n  EDGES rebuilt: ${newEdges.length} edge(s)`);
      flow.edges = newEdges;
      
      if (!DRY_RUN) {
        flow.markModified('nodes');
        flow.markModified('edges');
        await flow.save();
        console.log(`  ✅ SAVED to database.`);
      } else {
        console.log(`  [DRY RUN] Would save to database.`);
      }
    } else {
      console.log(`\n  No changes needed for this flow.`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Migration complete.');
  console.log(`${'='.repeat(60)}`);
  
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
