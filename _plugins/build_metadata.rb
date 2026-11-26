require "open3"

# =============================================================================
# Build metadata: inject build time + git SHA into site.config["build_metadata"]
# Used by _includes/footer.html. Resilient: never raises, always has a value.
# Works in three environments:
#   a) GitHub Actions  -> ENV["GITHUB_SHA"] is set
#   b) Local dev       -> git rev-parse HEAD (if .git exists)
#   c) Safe mode / no git -> falls back to a static string
# =============================================================================
Jekyll::Hooks.register :site, :after_init do |site|
  version = ENV["GITHUB_SHA"]
  version = nil if version.to_s.strip.empty?

  if version.nil?
    begin
      out, status = Open3.capture2("git", "rev-parse", "--short=7", "HEAD")
      version = out.strip if status.success? && !out.strip.empty?
    rescue StandardError
      version = nil
    end
  end

  version = (version || "dev")[0, 7]

  # site.time may be nil in some hook orderings; use Time.now as fallback
  build_time = site.time || Time.now
  date_str = build_time.utc.strftime("%Y-%m-%d %H:%M UTC")

  site.config["build_metadata"] = {
    "date" => date_str,
    "version" => version
  }
end
