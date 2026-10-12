package com.email.email_writer_ab.app;

import java.util.List;
import java.util.Locale;

public class EmailRequest {
    private static final List<String> SUPPORTED_TONES = List.of(
            "Professional", "Friendly", "Formal", "Casual", "Apologetic", "Persuasive"
    );
    private static final List<String> SUPPORTED_LENGTHS = List.of("Short", "Medium", "Detailed");

    private String emailContent;
    private String tone = "Professional";
    private String length = "Medium";

    public EmailRequest() {
    }

    public EmailRequest(String emailContent, String tone, String length) {
        this.emailContent = emailContent;
        this.tone = tone;
        this.length = length;
    }

    public String getEmailContent() {
        return emailContent;
    }

    public void setEmailContent(String emailContent) {
        this.emailContent = emailContent;
    }

    public String getTone() {
        return tone;
    }

    public void setTone(String tone) {
        this.tone = tone;
    }

    public String getLength() {
        return length;
    }

    public void setLength(String length) {
        this.length = length;
    }

    public void normalizeAndValidate() {
        tone = normalizeOption(tone, "Professional", SUPPORTED_TONES, "tone");
        length = normalizeOption(length, "Medium", SUPPORTED_LENGTHS, "length");
    }

    private String normalizeOption(String value, String defaultValue, List<String> supportedValues, String field) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }

        String normalizedValue = value.trim();
        return supportedValues.stream()
                .filter(option -> option.toLowerCase(Locale.ROOT).equals(normalizedValue.toLowerCase(Locale.ROOT)))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Invalid " + field + ". Supported values are: " + String.join(", ", supportedValues) + "."
                ));
    }
}