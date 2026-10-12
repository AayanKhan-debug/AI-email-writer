package com.email.email_writer_ab.app;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/email")
@CrossOrigin(origins = "*")
public class EmailGeneratorController {

    private final EmailGeneratorService emailGeneratorService;

    public EmailGeneratorController(EmailGeneratorService emailGeneratorService) {
        this.emailGeneratorService = emailGeneratorService;
    }

    @PostMapping("/generate")
    public ResponseEntity<String> generateEmail(@RequestBody EmailRequest emailRequest) {
        try {
            emailRequest.normalizeAndValidate();
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(exception.getMessage());
        }

        try {
            String response = emailGeneratorService.generateEmailReply(emailRequest);
            return ResponseEntity.ok(response);
        } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode()).body("AI Service error: " + e.getStatusCode());
        } catch (Exception e) {
            String message = e.getMessage() != null && !e.getMessage().isBlank() ? e.getMessage() : "Failed to generate reply.";
            return ResponseEntity.internalServerError().body("Error: " + message);
        }
    }

    @PostMapping("/summarize")
    public ResponseEntity<?> summarizeEmail(@RequestBody EmailSummarizeRequest summarizeRequest) {
        try {
            summarizeRequest.validate();
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(Map.of("error", exception.getMessage()));
        }

        try {
            String summary = emailGeneratorService.summarizeThread(summarizeRequest.getEmailContent());
            return ResponseEntity.ok(new EmailSummarizeResponse(summary));
        } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("error", "AI Service error: " + e.getStatusCode()));
        } catch (Exception e) {
            String message = e.getMessage() != null && !e.getMessage().isBlank() ? e.getMessage() : "Failed to summarize email thread.";
            return ResponseEntity.internalServerError().body(Map.of("error", "Error: " + message));
        }
    }
}