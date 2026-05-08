import assert from "node:assert/strict";
import test from "node:test";
import { frameSnapshotFromFigmaNode } from "./figma";

test("extracts text nodes from a Figma REST frame node", () => {
  const frame = frameSnapshotFromFigmaNode(
    {
      id: "12:34",
      name: "Hero",
      type: "FRAME",
      children: [
        {
          id: "12:35",
          name: "Title",
          type: "TEXT",
          characters: "Clean smarter",
          absoluteBoundingBox: { x: 1, y: 2, width: 3, height: 4 }
        },
        {
          id: "12:36",
          name: "Group",
          type: "GROUP",
          children: [
            {
              id: "12:37",
              name: "Hidden",
              type: "TEXT",
              visible: false,
              characters: "Hidden text"
            }
          ]
        }
      ]
    },
    "file_1"
  );

  assert.equal(frame.fileKey, "file_1");
  assert.equal(frame.nodeId, "12:34");
  assert.equal(frame.textNodes.length, 2);
  assert.equal(frame.textNodes[0]?.characters, "Clean smarter");
  assert.equal(frame.textNodes[1]?.visible, false);
});

test("extracts deeply nested auto-layout text nodes", () => {
  const frame = frameSnapshotFromFigmaNode(
    {
      id: "1:1",
      name: "Auto Layout Root",
      type: "FRAME",
      children: [
        {
          id: "1:2",
          name: "Section",
          type: "FRAME",
          children: [
            {
              id: "1:3",
              name: "Card",
              type: "INSTANCE",
              children: [
                {
                  id: "1:4",
                  name: "Stack",
                  type: "GROUP",
                  children: [
                    {
                      id: "1:5",
                      name: "Headline",
                      type: "TEXT",
                      characters: "Mother's Day Refresh Picks"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    "file_1"
  );

  assert.equal(frame.textNodes.length, 1);
  assert.equal(frame.textNodes[0]?.characters, "Mother's Day Refresh Picks");
  assert.deepEqual(frame.textNodes[0]?.parentPath, ["Auto Layout Root", "Section", "Card", "Stack"]);
});
