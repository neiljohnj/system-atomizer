def process_commands(commands: list[str]) -> list[str]:
    """Small upload fixture used by ATOM's browser workflow check."""
    return [command.strip() for command in commands if command.strip()]


if __name__ == "__main__":
    print("ATOM sample submission")
