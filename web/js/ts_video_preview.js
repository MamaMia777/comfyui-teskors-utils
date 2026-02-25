import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function chainCallback(object, property, callback) {
  if (!object) return;
  if (property in object && object[property]) {
    const orig = object[property];
    object[property] = function () {
      const r = orig.apply(this, arguments);
      return callback.apply(this, arguments) ?? r;
    };
  } else {
    object[property] = callback;
  }
}

function fitHeight(node) {
  // пересчитать размер ноды после смены превью
  node.setSize?.(node.size);
  app.graph.setDirtyCanvas(true, true);
}

function addVideoPreview(nodeType) {
  chainCallback(nodeType.prototype, "onNodeCreated", function () {
    const node = this;

    const root = document.createElement("div");
    root.style.width = "100%";

    const w = node.addDOMWidget("videopreview", "preview", root, {
      serialize: false,
      hideOnZoom: false,
      getValue() { return root.value; },
      setValue(v) { root.value = v; },
    });

    w.value = { hidden: false, paused: false, params: {}, muted: true };

    w.parentEl = document.createElement("div");
    w.parentEl.style.width = "100%";
    root.appendChild(w.parentEl);

    w.videoEl = document.createElement("video");
    w.videoEl.controls = false;
    w.videoEl.loop = true;
    w.videoEl.muted = true;
    w.videoEl.style.width = "100%";

    w.imgEl = document.createElement("img");
    w.imgEl.style.width = "100%";
    w.imgEl.hidden = true;

    w.videoEl.addEventListener("loadedmetadata", () => {
      w.aspectRatio = w.videoEl.videoWidth / w.videoEl.videoHeight;
      fitHeight(node);
    });
    w.imgEl.onload = () => {
      w.aspectRatio = w.imgEl.naturalWidth / w.imgEl.naturalHeight;
      fitHeight(node);
    };
    w.videoEl.addEventListener("error", () => {
      w.parentEl.hidden = true;
      fitHeight(node);
    });

    w.parentEl.appendChild(w.videoEl);
    w.parentEl.appendChild(w.imgEl);

    w.computeSize = function (width) {
      if (this.aspectRatio && !this.parentEl.hidden) {
        const h = (node.size[0] - 20) / this.aspectRatio + 10;
        this.computedHeight = h + 10;
        return [width, h];
      }
      return [width, -4]; // пока нет src — не показываем
    };

    let timeout = null;

    node.updateParameters = (params, forceUpdate) => {
      if (typeof w.value !== "object") w.value = { hidden: false, paused: false };
      if (!w.value.params) w.value.params = {};

      // не дёргаем лишний раз если значения не менялись
      const changed = Object.entries(params).some(([k, v]) => w.value.params[k] !== v);
      if (!changed) return;

      Object.assign(w.value.params, params);

      if (timeout) clearTimeout(timeout);
      if (forceUpdate) w.updateSource();
      else timeout = setTimeout(() => w.updateSource(), 80);
    };

    w.updateSource = function () {
      if (!this.value?.params) return;

      const params = { ...this.value.params, timestamp: Date.now() };
      this.parentEl.hidden = this.value.hidden;

      const fmt = params.format || "";
      const major = fmt.split("/")[0];

      // video/*
      if (major === "video" || fmt === "folder") {
        this.videoEl.autoplay = !this.value.paused && !this.value.hidden;
        this.videoEl.src = api.apiURL("/view?" + new URLSearchParams(params));
        this.videoEl.hidden = false;
        this.imgEl.hidden = true;
        return;
      }

      // image/*
      if (major === "image") {
        this.imgEl.src = api.apiURL("/view?" + new URLSearchParams(params));
        this.videoEl.hidden = true;
        this.imgEl.hidden = false;
      }
    };

    w.callback = w.updateSource;
  });
}

function addPreviewOptions(nodeType) {
  chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_, options) {
    const w = this.widgets?.find((x) => x.name === "videopreview");
    if (!w) return;

    let url = null;

    if (w.videoEl?.hidden === false && w.videoEl?.src) {
      // лучше всегда давать full quality через /view
      url = api.apiURL("/view?" + new URLSearchParams(w.value.params));
      url = url.replace("%2503d", "001");
    } else if (w.imgEl?.hidden === false && w.imgEl?.src) {
      url = w.imgEl.src;
    }

    const optNew = [];

    if (url) {
      optNew.push({
        content: "Open preview",
        callback: () => window.open(url, "_blank"),
      });
      optNew.push({
        content: "Save preview",
        callback: () => {
          const a = document.createElement("a");
          a.href = url;
          a.setAttribute("download", w.value.params.filename || "preview");
          document.body.append(a);
          a.click();
          requestAnimationFrame(() => a.remove());
        },
      });
    }

    if (w.videoEl?.hidden === false) {
      optNew.push({
        content: (w.value.paused ? "Resume" : "Pause") + " preview",
        callback: () => {
          if (w.value.paused) w.videoEl?.play();
          else w.videoEl?.pause();
          w.value.paused = !w.value.paused;
        },
      });
    }

    optNew.push({
      content: (w.value.hidden ? "Show" : "Hide") + " preview",
      callback: () => {
        if (!w.videoEl.hidden && !w.value.hidden) w.videoEl.pause();
        else if (w.value.hidden && !w.videoEl.hidden && !w.value.paused) w.videoEl.play();

        w.value.hidden = !w.value.hidden;
        w.parentEl.hidden = w.value.hidden;
        fitHeight(this);
      },
    });

    options.unshift(...optNew);
  });
}

app.registerExtension({
  name: "teskors.utils.ts_video_preview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    // поддержим оба имени, чтобы не зависеть от того как зарегистрировали ноду
    const isTS =
      nodeData?.name === "TSVideoCombine" ||
      nodeData?.name === "TSVideoCombineNoMetadata";

    if (!isTS) return;

    // когда нода отработала — ComfyUI пришлёт message.ui, и там ваш {"gifs":[{...preview...}]}
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      if (message?.gifs?.length) {
        this.updateParameters?.(message.gifs[0], true);
      }
    });

    addVideoPreview(nodeType);
    addPreviewOptions(nodeType);
  },
});