# Vela creative workspace

Vela combines text chat, image generation, and live voice. The redesign makes
those three ways to explore feel like one creative studio, with an ink background,
lilac and peach highlights, Space Grotesk headings, and DM Sans interface text.
The default appearance is dark; an existing saved appearance is respected.

The signature is an original CSS ribbon orb, shared by the overview, chat empty
state, and voice room. Voice animation follows existing session states. It is a
state indicator, not a measured microphone visualization. Motion stops when the
browser requests reduced motion.

The overview prompt launcher carries text into chat or image creation without
starting a paid request. Inspiration tiles fill an image prompt. Each paid action
still requires the existing explicit send, generate, or start control. Chat
suggestions now fill the composer for review before sending.

The image studio has a prompt panel, example prompts, and a large canvas. Existing
streaming, retry, generation, download, permission, transcript, session limits,
cleanup, and provider integrations remain in their original components.

Navigation includes an overview destination, desktop new-conversation action,
and mobile appearance control. All four views fit from 320px up. Keyboard focus,
labelled controls, a skip link, responsive layouts, and reduced motion are included.

## References

The implementation is original and uses the existing React and Lucide dependencies.
No paid template files or third-party component code were imported.

- [Shadcn Space AI Chatbox](https://shadcnspace.com/templates/ai-chatbox): focused composer and conversation layout.
- [Axiom](https://shadcndashboard.com/templates/axiom): workspace navigation and empty-state hierarchy.
- [21st.dev voice orbs](https://21st.dev/community/components/explore/ai-voice-orb): voice-centred visual direction.
- [React Bits](https://www.reactbits.dev/): ambient motion and orb treatment.
- [Aceternity](https://ui.aceternity.com/explore): illustrated cards and restrained hover motion.
- [Framer AI templates](https://www.framer.com/marketplace/templates/categories/ai/?page=1): typography and overview composition.
- [UI8](https://ui8.net/): creative workspace screen references.

Photographic inspiration is bundled locally so rendering does not require an
image CDN or changes to the existing content security policy:

- Alpine landscape: https://images.unsplash.com/photo-1464822759023-fed622ff2c3b
- Desert landscape: https://images.unsplash.com/photo-1509316785289-025f5b846b35

Decorative moons, spheres, frames, and the orb are CSS. Inspiration tiles are visual
references for prompts, not previously generated output or a user image history.
