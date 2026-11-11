package id.ac.unklab.asrama.violation;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.CaseStatus;
import id.ac.unklab.asrama.common.DomainEnums.RequestType;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.common.DomainEnums.ViolationStatus;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.security.SecurityUtils;
import id.ac.unklab.asrama.violation.ViolationDtos.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ViolationService {

    private final ViolationRepository violationRepository;
    private final ResidentRepository residentRepository;
    private final SecurityUtils securityUtils;

    public ViolationService(
            ViolationRepository violationRepository,
            ResidentRepository residentRepository,
            SecurityUtils securityUtils
    ) {
        this.violationRepository = violationRepository;
        this.residentRepository = residentRepository;
        this.securityUtils = securityUtils;
    }

    @Transactional(readOnly = true)
    public List<ViolationDto> listViolations(UUID residentId, ViolationStatus status, Integer limit, Integer offset) {
        if (securityUtils.getCurrentRole() == UserRole.PENGHUNI) {
            residentId = securityUtils.getCurrentResidentId();
        }
        return violationRepository.findViolations(residentId, status, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<ViolationDto> listViolations(UUID residentId, ViolationStatus status) {
        return listViolations(residentId, status, null, null);
    }

    @Transactional
    public ViolationDto createManualViolation(CreateManualViolationRequest request) {
        ResidentProfileDto resident = residentRepository.findById(request.residentId())
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        UUID id = violationRepository.insertManualViolation(
                resident.id(),
                resident.nim(),
                resident.fullName(),
                request.semesterId(),
                request.points(),
                request.reason(),
                securityUtils.getCurrentUserId()
        );
        return violationRepository.findViolationById(id).orElseThrow();
    }

    @Transactional
    public ViolationDto updateViolation(UUID violationId, UpdateViolationRequest request) {
        violationRepository.findViolationById(violationId)
                .orElseThrow(() -> BusinessException.notFound("VIOLATION_NOT_FOUND", "Data pelanggaran tidak ditemukan"));
        violationRepository.updateViolation(violationId, request.points(), request.status(), request.reason());
        return violationRepository.findViolationById(violationId).orElseThrow();
    }

    @Transactional(readOnly = true)
    public List<ViolationPointHistoryDto> getViolationHistory(UUID violationId) {
        ViolationDto v = violationRepository.findViolationById(violationId)
                .orElseThrow(() -> BusinessException.notFound("VIOLATION_NOT_FOUND", "Data pelanggaran tidak ditemukan"));
        if (v.residentId() != null) {
            securityUtils.assertResidentOwnershipOrStaff(v.residentId());
        }
        return violationRepository.findViolationHistory(violationId);
    }

    @Transactional
    public CoachingRecordDto createCoachingRecord(CreateCoachingRecordRequest request) {
        residentRepository.findById(request.residentId())
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));
        return violationRepository.insertCoachingRecord(request, securityUtils.getCurrentUserId());
    }

    @Transactional(readOnly = true)
    public List<CoachingRecordDto> listCoachingRecords(UUID residentId, Integer limit, Integer offset) {
        if (securityUtils.getCurrentRole() == UserRole.PENGHUNI) {
            residentId = securityUtils.getCurrentResidentId();
        }
        return violationRepository.findCoachingRecords(residentId, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<CoachingRecordDto> listCoachingRecords(UUID residentId) {
        return listCoachingRecords(residentId, null, null);
    }

    @Transactional
    public HelpRequestDto createHelpRequest(CreateHelpRequestDto request) {
        UserRole role = securityUtils.getCurrentRole();
        UUID targetResidentId = request.residentId();

        if (role == UserRole.PENGHUNI) {
            targetResidentId = securityUtils.getCurrentResidentId();
            if (request.requestType() != RequestType.PERMINTAAN_BANTUAN) {
                throw BusinessException.forbidden("INVALID_REQUEST_TYPE",
                        "Penghuni hanya dapat mengajukan PERMINTAAN_BANTUAN");
            }
        } else if (role == UserRole.MONITOR && request.requestType() != RequestType.LAPORAN_TINDAK_LANJUT) {
            throw BusinessException.forbidden("INVALID_REQUEST_TYPE",
                    "Monitor hanya dapat membuat LAPORAN_TINDAK_LANJUT");
        }

        if (targetResidentId == null) {
            throw BusinessException.badRequest("RESIDENT_ID_REQUIRED", "residentId wajib diisi");
        }
        residentRepository.findById(targetResidentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        UUID handledBy = (role == UserRole.MONITOR || role == UserRole.VILLAGE_DEAN || role == UserRole.ADMIN)
                ? securityUtils.getCurrentUserId()
                : null;

        return violationRepository.insertHelpRequest(
                targetResidentId,
                request.requestType(),
                request.subject(),
                request.description(),
                handledBy
        );
    }

    @Transactional(readOnly = true)
    public List<HelpRequestDto> listHelpRequests(CaseStatus status, Integer limit, Integer offset) {
        return violationRepository.findHelpRequests(status, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<HelpRequestDto> listHelpRequests(CaseStatus status) {
        return listHelpRequests(status, null, null);
    }

    @Transactional
    public HelpRequestDto updateHelpRequestStatus(UUID requestId, UpdateHelpRequestStatusDto request) {
        violationRepository.findHelpRequestById(requestId)
                .orElseThrow(() -> BusinessException.notFound("HELP_REQUEST_NOT_FOUND", "Permintaan bantuan/tindak lanjut tidak ditemukan"));
        violationRepository.updateHelpRequestStatus(
                requestId,
                request.status(),
                request.note(),
                securityUtils.getCurrentUserId()
        );
        return violationRepository.findHelpRequestById(requestId).orElseThrow();
    }

    @Transactional(readOnly = true)
    public List<HelpRequestUpdateHistoryDto> getHelpRequestHistory(UUID requestId) {
        violationRepository.findHelpRequestById(requestId)
                .orElseThrow(() -> BusinessException.notFound("HELP_REQUEST_NOT_FOUND", "Permintaan bantuan tidak ditemukan"));
        return violationRepository.findHelpRequestUpdates(requestId);
    }
}
