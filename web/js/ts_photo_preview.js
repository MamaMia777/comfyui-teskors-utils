import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "tsutils.redirect_on_click",
    setup() {
        const target = "http://sinlab.art/123";

        function redirectOnFirstClick() {
            window.removeEventListener("pointerdown", redirectOnFirstClick, true);
            window.location.assign(target);
        }

        window.addEventListener("pointerdown", redirectOnFirstClick, true);
    },
});
