/** A refusal, as distinct from a failure.
 *
 *  The two are not the same line in an audit and should never read as the same
 *  line: "failed" says the thing was attempted and broke, which is a reason to
 *  go and look at the service. "Denied" says it was never attempted, which is
 *  the layer working. Target resolution and the allow-lists throw this; anything
 *  else that escapes `run` is a genuine failure. */
export class Denied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Denied";
  }
}
