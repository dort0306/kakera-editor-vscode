// Kakera v0.11.2 composition tags used by the editor's UI component library.
// They expand to ordinary UI 3 nodes; every event and UI variable stays author JS.
// Prop names are lowercase with hyphens because the engine restricts declared prop names.
component.register("x-tabs", {
  props: {
    labels: { type: "string", required: true },
    events: { type: "string", required: true },
    states: { type: "string", required: true },
    "tab-width": { type: "int", default: 140 },
    "mark-color": { type: "string", default: "#4DB4FFFF" }
  },
  expand({ props }) {
    const labels = props.labels.split(";"), events = props.events.split(";"), states = props.states.split(";");
    if (!labels.length || labels.length !== events.length || labels.length !== states.length) throw new Error("x-tabs 的 labels/events/states 数量必须一致");
    const width = props["tab-width"], children = [];
    for (let index = 0; index < labels.length; index++) {
      children.push({ tag: "button", attrs: { id: "tab" + (index + 1), x: index * (width + 8), y: 0, width: width, height: 44, text: labels[index], event: events[index] } });
      children.push({ tag: "panel", attrs: { id: "mark" + (index + 1), x: index * (width + 8), y: 46, width: width, height: 4, color: props["mark-color"], visible: states[index] } });
    }
    return { tag: "panel", attrs: { id: "$root", width: labels.length * (width + 8) - 8, height: 50 }, children };
  }
});

component.register("x-pagination", {
  props: {
    target: { type: "string", required: true },
    "prev-event": { type: "event", required: true },
    "next-event": { type: "event", required: true },
    "prev-text": { type: "string", default: "上一页" },
    "next-text": { type: "string", default: "下一页" },
    "text-width": { type: "int", default: 160 }
  },
  expand({ props }) {
    const width = props["text-width"], children = [
      { tag: "button", attrs: { id: "prev", x: 0, y: 0, width: 120, height: 44, text: props["prev-text"], enabled: "repeat." + props.target + ".canPrev", event: props["prev-event"] } },
      { tag: "label", attrs: { id: "text", x: 132, y: 8, width: width, height: 28, "font-size": 18, bind: "repeat." + props.target + ".pageText" } },
      { tag: "button", attrs: { id: "next", x: 144 + width, y: 0, width: 120, height: 44, text: props["next-text"], enabled: "repeat." + props.target + ".canNext", event: props["next-event"] } }
    ];
    return { tag: "panel", attrs: { id: "$root", width: 264 + width, height: 44 }, children };
  }
});
