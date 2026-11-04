using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.RateLimiting;

// Moment this process started: used to measure how long a commit took to reach production.
var startedAt = DateTimeOffset.UtcNow;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient("github", c =>
{
    c.BaseAddress = new Uri("https://api.github.com/");
    c.DefaultRequestHeaders.UserAgent.ParseAdd("milanvulin-site");
    c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
    c.Timeout = TimeSpan.FromSeconds(8);
});
builder.Services.AddSingleton(new BuildInfo(
    Sha: builder.Configuration["GIT_SHA"] ?? "dev",
    Repo: builder.Configuration["GITHUB_REPO"] ?? "vulinm/milanvulin-site",
    StartedAt: startedAt));
builder.Services.AddSingleton<DeployFeed>();

// Local language model (optional): see ChatService. The client has no timeout because answers stream.
builder.Services.AddHttpClient("llm", c => c.Timeout = Timeout.InfiniteTimeSpan);
builder.Services.AddSingleton<ChatService>();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per visitor: Cloudflare puts the real address in this header (the API is only reachable through it).
    o.AddPolicy("chat", ctx => RateLimitPartition.GetSlidingWindowLimiter(
        ctx.Request.Headers["CF-Connecting-IP"].ToString() is { Length: > 0 } ip ? ip : "unknown",
        _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = 8,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 4,
            QueueLimit = 0,
        }));
});

var app = builder.Build();
app.UseRateLimiter();

// Internal only: the web container forwards just /api/*, so this is never reachable from outside.
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// Which commit this container was built from, and when it came up.
app.MapGet("/api/version", (BuildInfo info) => new { sha = info.Sha, repo = info.Repo, startedAt = info.StartedAt });

// Recent runs of the build workflow (public GitHub data, cached for a minute).
app.MapGet("/api/deploys", async (DeployFeed feed, CancellationToken ct) => new { runs = await feed.GetAsync(ct) });

// Shows the visitor how their own request reached this container.
// Values come from Cloudflare headers; nothing here is stored or logged.
app.MapGet("/api/trace", (HttpContext ctx, BuildInfo info) =>
{
    ctx.Response.Headers.CacheControl = "no-store";

    string? Header(string name) => ctx.Request.Headers.TryGetValue(name, out var v) ? v.ToString() : null;

    var ray = Header("CF-Ray");
    var dash = ray?.LastIndexOf('-') ?? -1;
    return new
    {
        viaCloudflare = ray is not null,
        rayId = ray,
        colo = dash >= 0 ? ray![(dash + 1)..] : null,
        country = Header("CF-IPCountry"),
        visitorIp = Header("CF-Connecting-IP"),
        scheme = ParseScheme(Header("CF-Visitor")),
        host = Header("Host"),
        container = Environment.MachineName,
        startedAt = info.StartedAt,
    };
});

// Chat with the local model. Status says whether the feature is configured and the model answers.
app.MapGet("/api/chat/status", async (ChatService chat, CancellationToken ct) => await chat.GetStatusAsync(ct));

app.MapPost("/api/chat", async (HttpContext ctx, ChatRequest? request, ChatService chat, CancellationToken ct) =>
{
    if (!chat.Enabled) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    var problem = ChatService.Validate(request, out var history);
    if (problem is not null) return Results.BadRequest(new { error = problem });

    if (!chat.TryAcquire())
        return Results.Json(new { error = "busy" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    try
    {
        await chat.StreamAsync(ctx, history, ct);
    }
    finally
    {
        chat.Release();
    }
    return Results.Empty;
}).RequireRateLimiting("chat");

// Says in the log which profile text the chat model got, so an update can be verified.
app.Logger.LogInformation("Chat profile: {Source}, {Chars} characters", ChatPrompt.ProfileSource, ChatPrompt.Profile.Length);

app.Run();

static string? ParseScheme(string? cfVisitor)
{
    if (string.IsNullOrEmpty(cfVisitor)) return null;
    try { return JsonNode.Parse(cfVisitor)?["scheme"]?.GetValue<string>(); }
    catch (JsonException) { return null; }
}

public sealed record BuildInfo(string Sha, string Repo, DateTimeOffset StartedAt);

public sealed record DeployRun(
    string Sha,
    string Message,
    string Status,
    string? Conclusion,
    DateTimeOffset Started,
    DateTimeOffset Updated,
    string Url);

// Fetches the latest runs of build.yml from the public GitHub API. At most one request a minute,
// and when GitHub is unavailable the last good answer keeps being served.
public sealed class DeployFeed(IHttpClientFactory http, BuildInfo info, ILogger<DeployFeed> log)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _fetched = DateTimeOffset.MinValue;
    private IReadOnlyList<DeployRun> _runs = [];

    public async Task<IReadOnlyList<DeployRun>> GetAsync(CancellationToken ct)
    {
        if (DateTimeOffset.UtcNow - _fetched < Ttl) return _runs;

        await _gate.WaitAsync(ct);
        try
        {
            if (DateTimeOffset.UtcNow - _fetched < Ttl) return _runs;
            try
            {
                _runs = await FetchAsync(ct);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or FormatException)
            {
                log.LogWarning(e, "Could not fetch workflow runs from GitHub");
            }
            _fetched = DateTimeOffset.UtcNow; // also after a failure, so a GitHub outage is retried once a minute
        }
        finally
        {
            _gate.Release();
        }
        return _runs;
    }

    private async Task<IReadOnlyList<DeployRun>> FetchAsync(CancellationToken ct)
    {
        var client = http.CreateClient("github");
        var body = await client.GetStringAsync(
            $"repos/{info.Repo}/actions/workflows/build.yml/runs?branch=main&per_page=10", ct);
        var items = JsonNode.Parse(body)?["workflow_runs"]?.AsArray() ?? new JsonArray();

        var list = new List<DeployRun>();
        foreach (var r in items)
        {
            if (r is null) continue;
            var started = Time(r["run_started_at"]) ?? Time(r["created_at"]);
            var updated = Time(r["updated_at"]);
            if (started is null || updated is null) continue;

            var message = (Text(r["head_commit"]?["message"]) ?? "").Split('\n')[0];
            if (message.Length > 100) message = message[..100] + "…";

            list.Add(new DeployRun(
                Sha: Text(r["head_sha"]) ?? "",
                Message: message,
                Status: Text(r["status"]) ?? "unknown",
                Conclusion: Text(r["conclusion"]),
                Started: started.Value,
                Updated: updated.Value,
                Url: Text(r["html_url"]) ?? ""));
        }
        return list;
    }

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static DateTimeOffset? Time(JsonNode? n) =>
        Text(n) is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)
            ? t
            : null;
}
