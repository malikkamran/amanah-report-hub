# Amanah Report Hub

Public static deployment for Amanah Report Hub.

Hosting: GitHub Pages.

Cloud storage: KVdb free key-value bucket. The app stores a small index, one metadata key per issue, and compressed screenshot chunks per issue. This keeps the browser experience fast and avoids paid infrastructure.

Important: KVdb requires the bucket owner's email to be verified before browser writes are accepted.
