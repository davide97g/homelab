import { Panel, useReactFlow } from "@xyflow/react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Zoom and fit, in the hub's own buttons rather than React Flow's `<Controls>`.
 *  That component ships its own light-mode styling and reads as a white brick in
 *  dark, and theming it means overriding its CSS from outside this lazy chunk —
 *  three buttons against the token set is less code and cannot drift. Shared by
 *  both /media canvases. */
export function Viewport({ fitLabel }: { fitLabel: string }) {
  const flow = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex flex-col gap-1">
      <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => flow.zoomIn()}>
        <Plus />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => flow.zoomOut()}>
        <Minus />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={fitLabel}
        onClick={() => flow.fitView({ padding: 0.12, maxZoom: 1 })}
      >
        <Maximize2 />
      </Button>
    </Panel>
  );
}
