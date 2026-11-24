require "open3"

Jekyll::Hooks.register :site, :after_init do |site|
  version = ENV["GITHUB_SHA"]

  if version.nil? || version.empty?
    version, status = Open3.capture2("git", "rev-parse", "--short=7", "HEAD")
    raise "Unable to determine the Git commit for build metadata" unless status.success?
  end

  site.config["build_metadata"] = {
    "date" => site.time.utc.strftime("%Y-%m-%d %H:%M UTC"),
    "version" => version[0, 7]
  }
end
